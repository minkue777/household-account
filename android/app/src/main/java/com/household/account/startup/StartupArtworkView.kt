package com.household.account.startup

import android.content.Context
import android.util.AttributeSet
import androidx.appcompat.widget.AppCompatImageView

/** 세로 휴대폰은 배경을 채우고, 문구가 잘릴 수 있는 화면 비율은 원본을 보존합니다. */
class StartupArtworkView(context: Context, attrs: AttributeSet) : AppCompatImageView(context, attrs) {
    override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
        scaleType = if (height > 0 && width * 8 >= height * 3 && width * 16 <= height * 9) {
            ScaleType.CENTER_CROP
        } else {
            ScaleType.FIT_CENTER
        }
        super.onSizeChanged(width, height, oldWidth, oldHeight)
    }
}
