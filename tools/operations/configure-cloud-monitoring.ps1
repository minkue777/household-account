param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectId,

    [Parameter(Mandatory = $true)]
    [string]$NotificationChannelResource,

    [switch]$Apply
)

$ErrorActionPreference = "Stop"

if ($NotificationChannelResource -notmatch "^projects/[^/]+/notificationChannels/[^/]+$") {
    throw "NotificationChannelResource must be a Cloud Monitoring notification channel resource name."
}

$metrics = @(
    @{
        Name = "household_provider_health_alert_open"
        Description = "Provider health transitions that opened an outage incident."
        Filter = 'resource.type="cloud_run_revision" AND jsonPayload.eventType="provider-health-alert-transition" AND jsonPayload.transition="opened"'
    },
    @{
        Name = "household_scheduled_job_incident_open"
        Description = "Scheduled job Missing or Overdue incidents."
        Filter = 'resource.type="cloud_run_revision" AND jsonPayload.eventType="SCHEDULED_JOB_INCIDENT_OPENED"'
    },
    @{
        Name = "household_scheduled_job_monitor_heartbeat"
        Description = "Successful five-minute scheduled job monitor heartbeats."
        Filter = 'resource.type="cloud_run_revision" AND jsonPayload.eventType="SCHEDULED_JOB_MONITOR_HEARTBEAT"'
    }
)

function Invoke-Gcloud([string[]]$Arguments) {
    if (-not $Apply) {
        Write-Host ("gcloud " + ($Arguments -join " "))
        return
    }
    & gcloud @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "gcloud command failed: $($Arguments -join ' ')"
    }
}

foreach ($metric in $metrics) {
    if ($Apply) {
        $existing = & gcloud logging metrics describe $metric.Name --project $ProjectId --format="value(name)" 2>$null
        $verb = if ($LASTEXITCODE -eq 0 -and $existing) { "update" } else { "create" }
    } else {
        $verb = "create-or-update"
    }
    Invoke-Gcloud @(
        "logging", "metrics", $verb, $metric.Name,
        "--project", $ProjectId,
        "--description", $metric.Description,
        "--log-filter", $metric.Filter
    )
}

$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "household-account-monitoring"
New-Item -ItemType Directory -Force -Path $temporaryDirectory | Out-Null

function Write-Policy(
    [string]$FileName,
    [string]$DisplayName,
    [hashtable]$Condition
) {
    $policy = @{
        displayName = $DisplayName
        combiner = "OR"
        enabled = $true
        notificationChannels = @($NotificationChannelResource)
        alertStrategy = @{
            autoClose = "1800s"
            notificationPrompts = @("OPENED", "CLOSED")
        }
        documentation = @{
            mimeType = "text/markdown"
            content = "Firestore operations/runtime 상태와 Cloud Logging의 execution key hash를 확인하십시오. 원문 credential·가구 ID·보유수량은 로그에 남지 않습니다."
        }
        conditions = @($Condition)
    }
    $path = Join-Path $temporaryDirectory $FileName
    $policy | ConvertTo-Json -Depth 20 | Set-Content -Encoding utf8 $path
    return $path
}

function Threshold-Condition([string]$DisplayName, [string]$MetricName) {
    return @{
        displayName = $DisplayName
        conditionThreshold = @{
            filter = "resource.type=`"cloud_run_revision`" AND metric.type=`"logging.googleapis.com/user/$MetricName`""
            comparison = "COMPARISON_GT"
            thresholdValue = 0
            duration = "0s"
            aggregations = @(@{
                alignmentPeriod = "300s"
                perSeriesAligner = "ALIGN_SUM"
                crossSeriesReducer = "REDUCE_SUM"
            })
            trigger = @{ count = 1 }
        }
    }
}

$policies = @(
    @{
        Name = "Household Account - Provider 장애"
        File = "provider-health.json"
        Condition = Threshold-Condition "Provider outage opened" "household_provider_health_alert_open"
    },
    @{
        Name = "Household Account - 예약 작업 누락 또는 정체"
        File = "scheduled-job-incident.json"
        Condition = Threshold-Condition "Scheduled job incident opened" "household_scheduled_job_incident_open"
    },
    @{
        Name = "Household Account - 예약 감시기 중단"
        File = "scheduled-monitor-absence.json"
        Condition = @{
            displayName = "No monitor heartbeat for ten minutes"
            conditionAbsent = @{
                filter = 'resource.type="cloud_run_revision" AND metric.type="logging.googleapis.com/user/household_scheduled_job_monitor_heartbeat"'
                duration = "600s"
                aggregations = @(@{
                    alignmentPeriod = "300s"
                    perSeriesAligner = "ALIGN_SUM"
                    crossSeriesReducer = "REDUCE_SUM"
                })
                trigger = @{ count = 1 }
            }
        }
    }
)

foreach ($policy in $policies) {
    $path = Write-Policy $policy.File $policy.Name $policy.Condition
    if (-not $Apply) {
        Write-Host "gcloud monitoring policies create-or-update --project $ProjectId --display-name '$($policy.Name)' --policy-from-file $path"
    } else {
        $existingPolicy = & gcloud monitoring policies list --project $ProjectId --filter="displayName='$($policy.Name)'" --format="value(name)" 2>$null
        if ($LASTEXITCODE -eq 0 -and $existingPolicy) {
        Invoke-Gcloud @(
            "monitoring", "policies", "update", $existingPolicy,
            "--project", $ProjectId,
            "--policy-from-file", $path
        )
        } else {
            Invoke-Gcloud @(
                "monitoring", "policies", "create",
                "--project", $ProjectId,
                "--policy-from-file", $path
            )
        }
    }
}

if (-not $Apply) {
    Write-Host "Dry run only. Re-run with -Apply after reviewing the generated policy files in $temporaryDirectory."
}
