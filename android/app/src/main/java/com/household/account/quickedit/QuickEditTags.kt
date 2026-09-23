package com.household.account.quickedit

const val MAX_QUICK_EDIT_TAGS = 10
const val MAX_QUICK_EDIT_TAG_LENGTH = 30

sealed interface QuickEditTagsValidation {
    data class Valid(val tags: List<String>) : QuickEditTagsValidation
    data class Invalid(val message: String) : QuickEditTagsValidation
}

/** Web과 동일하게 앞쪽 #만 제거하고 태그 내부 공백·구두점과 대소문자는 보존합니다. */
fun normalizeQuickEditTags(tags: List<String>): List<String> = tags
    .map { tag -> tag.trimTagWhitespace().trimStart('#').trimTagWhitespace() }
    .filter(String::isNotEmpty)
    .distinct()

fun validateQuickEditTags(
    tags: List<String>,
    originalTags: List<String>? = null
): QuickEditTagsValidation {
    val normalized = normalizeQuickEditTags(tags)
    // 예전 한도로 저장한 기존 태그는 다른 필드만 편집할 때 손실 없이 보존합니다.
    if (originalTags != null && normalized == normalizeQuickEditTags(originalTags)) {
        return QuickEditTagsValidation.Valid(normalized)
    }
    if (normalized.any { it.codePointCount(0, it.length) > MAX_QUICK_EDIT_TAG_LENGTH }) {
        return QuickEditTagsValidation.Invalid("태그는 30자까지 입력할 수 있습니다")
    }
    if (normalized.size > MAX_QUICK_EDIT_TAGS) {
        return QuickEditTagsValidation.Invalid("태그는 최대 10개까지 추가할 수 있습니다")
    }
    return QuickEditTagsValidation.Valid(normalized)
}

private fun String.trimTagWhitespace(): String = trim { character ->
    // ECMAScript String.trim의 공백 집합으로 서버와 정규화 결과를 맞춥니다.
    character in '\u0009'..'\u000D' || character == '\u0020' || character == '\u00A0' ||
        character == '\u1680' || character in '\u2000'..'\u200A' || character == '\u2028' ||
        character == '\u2029' || character == '\u202F' || character == '\u205F' ||
        character == '\u3000' || character == '\uFEFF'
}
