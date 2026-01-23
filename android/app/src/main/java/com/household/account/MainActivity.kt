package com.household.account

import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.household.account.service.CardNotificationListenerService
import com.household.account.ui.MainScreen
import com.household.account.ui.StatsScreen
import com.household.account.ui.theme.HouseholdAccountTheme

enum class Screen {
    Main,
    Stats
}

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            HouseholdAccountTheme {
                var hasNotificationPermission by remember {
                    mutableStateOf(isNotificationListenerEnabled())
                }

                var currentScreen by remember { mutableStateOf(Screen.Main) }

                if (hasNotificationPermission) {
                    when (currentScreen) {
                        Screen.Main -> MainScreen(
                            onSettingsClick = {
                                // 설정 화면으로 이동 (나중에 구현)
                            },
                            onStatsClick = {
                                currentScreen = Screen.Stats
                            }
                        )
                        Screen.Stats -> StatsScreen(
                            onBackClick = {
                                currentScreen = Screen.Main
                            }
                        )
                    }
                } else {
                    NotificationPermissionScreen(
                        onRequestPermission = {
                            openNotificationListenerSettings()
                        },
                        onCheckPermission = {
                            hasNotificationPermission = isNotificationListenerEnabled()
                        }
                    )
                }
            }
        }
    }

    /**
     * 알림 접근 권한이 활성화되어 있는지 확인
     */
    private fun isNotificationListenerEnabled(): Boolean {
        val packageName = packageName
        val flat = Settings.Secure.getString(
            contentResolver,
            "enabled_notification_listeners"
        )
        return flat?.contains(packageName) == true
    }

    /**
     * 알림 접근 설정 화면 열기
     */
    private fun openNotificationListenerSettings() {
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        startActivity(intent)
    }
}

@Composable
fun NotificationPermissionScreen(
    onRequestPermission: () -> Unit,
    onCheckPermission: () -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = "알림 접근 권한 필요",
                style = MaterialTheme.typography.headlineMedium
            )

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "카드 결제 알림을 자동으로 기록하려면\n알림 접근 권한이 필요합니다.",
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(32.dp))

            Button(
                onClick = onRequestPermission,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("권한 설정하기")
            }

            Spacer(modifier = Modifier.height(16.dp))

            OutlinedButton(
                onClick = onCheckPermission,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("권한 확인")
            }

            Spacer(modifier = Modifier.height(32.dp))

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = "설정 방법",
                        style = MaterialTheme.typography.titleSmall
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "1. '권한 설정하기' 버튼을 누릅니다\n" +
                                "2. '또니망고네 가계부' 앱을 찾습니다\n" +
                                "3. 토글을 켜서 권한을 허용합니다\n" +
                                "4. 이 화면으로 돌아와 '권한 확인'을 누릅니다",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}
