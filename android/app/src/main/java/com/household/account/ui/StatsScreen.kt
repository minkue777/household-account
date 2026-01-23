package com.household.account.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.household.account.data.Category
import com.household.account.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatsScreen(
    viewModel: MainViewModel = viewModel(),
    onBackClick: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("통계") },
                navigationIcon = {
                    IconButton(onClick = onBackClick) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "뒤로")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Primary,
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White
                )
            )
        }
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .background(Background),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 월 선택 & 총액
            item {
                StatsMonthSelectorCard(
                    year = uiState.currentYear,
                    month = uiState.currentMonth,
                    totalAmount = viewModel.getMonthlyTotal(),
                    onPreviousMonth = viewModel::previousMonth,
                    onNextMonth = viewModel::nextMonth
                )
            }

            // 도넛 차트
            item {
                StatsDonutChartCard(
                    categoryTotals = viewModel.getCategoryTotals(),
                    totalAmount = viewModel.getMonthlyTotal()
                )
            }

            // 카테고리 요약
            item {
                StatsCategorySummaryCard(
                    categoryTotals = viewModel.getCategoryTotals(),
                    totalAmount = viewModel.getMonthlyTotal()
                )
            }
        }
    }
}

@Composable
fun StatsMonthSelectorCard(
    year: Int,
    month: Int,
    totalAmount: Int,
    onPreviousMonth: () -> Unit,
    onNextMonth: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = Surface)
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onPreviousMonth) {
                    Icon(Icons.Default.ChevronLeft, "이전 달")
                }
                Text(
                    text = "${year}년 ${month}월",
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )
                IconButton(onClick = onNextMonth) {
                    Icon(Icons.Default.ChevronRight, "다음 달")
                }
            }

            Box(
                modifier = Modifier
                    .padding(vertical = 12.dp)
                    .fillMaxWidth()
                    .height(1.dp)
                    .background(SurfaceVariant)
            )

            Text(
                text = "이번 달 총 지출",
                fontSize = 14.sp,
                color = TextSecondary
            )
            Text(
                text = "${"%,d".format(totalAmount)}원",
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                color = OnSurface
            )
        }
    }
}

@Composable
fun StatsDonutChartCard(
    categoryTotals: Map<Category, Int>,
    totalAmount: Int
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = Surface)
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "카테고리별 비율",
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 16.dp)
            )

            if (totalAmount == 0) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(200.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "데이터 없음",
                        color = TextSecondary
                    )
                }
            } else {
                Box(
                    modifier = Modifier
                        .size(200.dp)
                        .padding(16.dp),
                    contentAlignment = Alignment.Center
                ) {
                    val sortedCategories = categoryTotals.entries
                        .sortedByDescending { it.value }
                        .filter { it.value > 0 }

                    Canvas(modifier = Modifier.fillMaxSize()) {
                        val strokeWidth = 40f
                        val radius = (size.minDimension - strokeWidth) / 2
                        val center = Offset(size.width / 2, size.height / 2)

                        var startAngle = -90f

                        sortedCategories.forEach { (category, amount) ->
                            val sweepAngle = (amount.toFloat() / totalAmount) * 360f
                            val color = when (category) {
                                Category.LIVING -> CategoryLiving
                                Category.CHILDCARE -> CategoryChildcare
                                Category.FIXED -> CategoryFixed
                                Category.FOOD -> CategoryFood
                                Category.ETC -> CategoryEtc
                            }

                            drawArc(
                                color = color,
                                startAngle = startAngle,
                                sweepAngle = sweepAngle,
                                useCenter = false,
                                topLeft = Offset(center.x - radius, center.y - radius),
                                size = Size(radius * 2, radius * 2),
                                style = Stroke(width = strokeWidth)
                            )

                            startAngle += sweepAngle
                        }
                    }

                    // 중앙 총액
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = "총 지출",
                            fontSize = 12.sp,
                            color = TextSecondary
                        )
                        Text(
                            text = "${"%,d".format(totalAmount)}원",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }

                // 범례
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp),
                    horizontalArrangement = Arrangement.Center
                ) {
                    val sortedCategories = categoryTotals.entries
                        .sortedByDescending { it.value }
                        .filter { it.value > 0 }

                    sortedCategories.forEach { (category, _) ->
                        val color = when (category) {
                            Category.LIVING -> CategoryLiving
                            Category.CHILDCARE -> CategoryChildcare
                            Category.FIXED -> CategoryFixed
                            Category.FOOD -> CategoryFood
                            Category.ETC -> CategoryEtc
                        }

                        Row(
                            modifier = Modifier.padding(horizontal = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(10.dp)
                                    .clip(CircleShape)
                                    .background(color)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = category.label,
                                fontSize = 11.sp,
                                color = TextSecondary
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun StatsCategorySummaryCard(
    categoryTotals: Map<Category, Int>,
    totalAmount: Int
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = Surface)
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Text(
                text = "카테고리별 지출",
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(bottom = 16.dp)
            )

            if (totalAmount == 0) {
                Text(
                    text = "데이터 없음",
                    color = TextSecondary,
                    modifier = Modifier.padding(vertical = 16.dp)
                )
            } else {
                val sortedCategories = categoryTotals.entries
                    .sortedByDescending { it.value }

                sortedCategories.forEach { (category, amount) ->
                    val percentage = if (totalAmount > 0) {
                        (amount.toFloat() / totalAmount * 100)
                    } else 0f

                    StatsCategoryRow(
                        category = category,
                        amount = amount,
                        percentage = percentage
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                }
            }
        }
    }
}

@Composable
fun StatsCategoryRow(
    category: Category,
    amount: Int,
    percentage: Float
) {
    val categoryColor = when (category) {
        Category.LIVING -> CategoryLiving
        Category.CHILDCARE -> CategoryChildcare
        Category.FIXED -> CategoryFixed
        Category.FOOD -> CategoryFood
        Category.ETC -> CategoryEtc
    }

    Column {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(12.dp)
                        .clip(CircleShape)
                        .background(categoryColor)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = category.label,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "%.1f%%".format(percentage),
                    fontSize = 12.sp,
                    color = TextSecondary
                )
            }
            Text(
                text = "${"%,d".format(amount)}원",
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold
            )
        }
        Spacer(modifier = Modifier.height(4.dp))
        LinearProgressIndicator(
            progress = percentage / 100f,
            modifier = Modifier
                .fillMaxWidth()
                .height(6.dp)
                .clip(RoundedCornerShape(3.dp)),
            color = categoryColor,
            trackColor = SurfaceVariant
        )
    }
}
