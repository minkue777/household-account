package com.household.account.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Close
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
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.viewmodel.compose.viewModel
import com.household.account.data.Category
import com.household.account.data.Expense
import com.household.account.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatsScreen(
    viewModel: MainViewModel = viewModel(),
    onBackClick: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    var selectedCategory by remember { mutableStateOf<Category?>(null) }

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
                    totalAmount = viewModel.getMonthlyTotal(),
                    onCategoryClick = { category -> selectedCategory = category }
                )
            }

            // 카테고리 요약
            item {
                StatsCategorySummaryCard(
                    categoryTotals = viewModel.getCategoryTotals(),
                    totalAmount = viewModel.getMonthlyTotal(),
                    onCategoryClick = { category -> selectedCategory = category }
                )
            }
        }
    }

    // 카테고리별 지출 내역 다이얼로그
    selectedCategory?.let { category ->
        val expenses = viewModel.getExpensesByCategory(category)
        CategoryExpenseDialog(
            category = category,
            expenses = expenses,
            onDismiss = { selectedCategory = null }
        )
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
    totalAmount: Int,
    onCategoryClick: (Category) -> Unit = {}
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
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // 도넛 차트
                    Box(
                        modifier = Modifier
                            .size(160.dp)
                            .padding(8.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        val sortedCategories = categoryTotals.entries
                            .sortedByDescending { it.value }
                            .filter { it.value > 0 }

                        Canvas(modifier = Modifier.fillMaxSize()) {
                            val strokeWidth = 32f
                            val radius = (size.minDimension - strokeWidth) / 2
                            val center = Offset(size.width / 2, size.height / 2)

                            var startAngle = -90f

                            sortedCategories.forEach { (category, amount) ->
                                val sweepAngle = (amount.toFloat() / totalAmount) * 360f
                                val color = getCategoryColor(category)

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
                                fontSize = 10.sp,
                                color = TextSecondary
                            )
                            Text(
                                text = "${"%,d".format(totalAmount)}",
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = "원",
                                fontSize = 10.sp,
                                color = TextSecondary
                            )
                        }
                    }

                    // 범례 (세로 배치, 클릭 가능)
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .padding(start = 8.dp)
                    ) {
                        val sortedCategories = categoryTotals.entries
                            .sortedByDescending { it.value }
                            .filter { it.value > 0 }

                        sortedCategories.forEach { (category, amount) ->
                            val color = getCategoryColor(category)
                            val percentage = if (totalAmount > 0) {
                                (amount.toFloat() / totalAmount * 100).toInt()
                            } else 0

                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .clickable { onCategoryClick(category) }
                                    .padding(vertical = 6.dp, horizontal = 8.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Box(
                                        modifier = Modifier
                                            .size(10.dp)
                                            .clip(CircleShape)
                                            .background(color)
                                    )
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text(
                                        text = category.label,
                                        fontSize = 12.sp,
                                        color = OnSurface
                                    )
                                }
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        text = "${"%,d".format(amount)}원",
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Medium,
                                        color = OnSurface
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text(
                                        text = "${percentage}%",
                                        fontSize = 10.sp,
                                        color = TextSecondary
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// 카테고리 색상 헬퍼 함수
private fun getCategoryColor(category: Category): Color {
    return when (category) {
        Category.LIVING -> CategoryLiving
        Category.CHILDCARE -> CategoryChildcare
        Category.FIXED -> CategoryFixed
        Category.FOOD -> CategoryFood
        Category.ETC -> CategoryEtc
    }
}

@Composable
fun StatsCategorySummaryCard(
    categoryTotals: Map<Category, Int>,
    totalAmount: Int,
    onCategoryClick: (Category) -> Unit = {}
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
                        percentage = percentage,
                        onClick = { onCategoryClick(category) }
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
    percentage: Float,
    onClick: () -> Unit = {}
) {
    val categoryColor = getCategoryColor(category)

    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .clickable { onClick() }
    ) {
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

// 카테고리별 지출 내역 다이얼로그
@Composable
fun CategoryExpenseDialog(
    category: Category,
    expenses: List<Expense>,
    onDismiss: () -> Unit
) {
    val categoryColor = getCategoryColor(category)
    val totalAmount = expenses.sumOf { it.amount }

    Dialog(onDismissRequest = onDismiss) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 500.dp),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = Surface)
        ) {
            Column {
                // 헤더
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(CircleShape)
                                .background(categoryColor),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = category.label.take(2),
                                color = Color.White,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Medium
                            )
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text(
                                text = category.label,
                                fontSize = 18.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                            Text(
                                text = "${expenses.size}건 · ${"%,d".format(totalAmount)}원",
                                fontSize = 13.sp,
                                color = TextSecondary
                            )
                        }
                    }
                    IconButton(onClick = onDismiss) {
                        Icon(
                            Icons.Default.Close,
                            contentDescription = "닫기",
                            tint = TextSecondary
                        )
                    }
                }

                Divider(color = SurfaceVariant)

                // 지출 내역 리스트
                if (expenses.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(32.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "지출 내역이 없습니다",
                            color = TextSecondary
                        )
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(expenses) { expense ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(SurfaceVariant.copy(alpha = 0.5f))
                                    .padding(12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = expense.merchant,
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Medium
                                    )
                                    Text(
                                        text = expense.date + if (expense.memo.isNotEmpty()) " · ${expense.memo}" else "",
                                        fontSize = 12.sp,
                                        color = TextSecondary
                                    )
                                }
                                Text(
                                    text = "${"%,d".format(expense.amount)}원",
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
