package com.household.account.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.household.account.data.Category
import com.household.account.data.Expense
import com.household.account.ui.theme.*
import androidx.compose.foundation.Canvas
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import java.time.LocalDate
import java.time.YearMonth
import kotlin.math.cos
import kotlin.math.sin

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(
    viewModel: MainViewModel = viewModel(),
    onSettingsClick: () -> Unit = {},
    onStatsClick: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    var showAddDialog by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("또니망고네 가계부") },
                actions = {
                    IconButton(onClick = onStatsClick) {
                        Icon(Icons.Default.BarChart, contentDescription = "통계")
                    }
                    IconButton(onClick = onSettingsClick) {
                        Icon(Icons.Default.Settings, contentDescription = "설정")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Primary,
                    titleContentColor = Color.White,
                    actionIconContentColor = Color.White
                )
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { showAddDialog = true },
                containerColor = Primary
            ) {
                Icon(Icons.Default.Add, contentDescription = "추가", tint = Color.White)
            }
        }
    ) { paddingValues ->
        // 수동 추가 다이얼로그
        if (showAddDialog) {
            AddExpenseDialog(
                selectedDate = uiState.selectedDate,
                onDismiss = { showAddDialog = false },
                onConfirm = { merchant, amount, category, date ->
                    viewModel.addManualExpense(merchant, amount, category, date)
                    showAddDialog = false
                }
            )
        }
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
                MonthSelectorCard(
                    year = uiState.currentYear,
                    month = uiState.currentMonth,
                    totalAmount = viewModel.getMonthlyTotal(),
                    onPreviousMonth = viewModel::previousMonth,
                    onNextMonth = viewModel::nextMonth
                )
            }

            // 캘린더
            item {
                CalendarCard(
                    year = uiState.currentYear,
                    month = uiState.currentMonth,
                    selectedDate = uiState.selectedDate,
                    onDateClick = viewModel::selectDate,
                    getDailyTotal = viewModel::getDailyTotal
                )
            }

            // 카테고리 요약
            item {
                CategorySummaryCard(
                    categoryTotals = viewModel.getCategoryTotals(),
                    totalAmount = viewModel.getMonthlyTotal()
                )
            }

            // 선택된 날짜의 상세 내역
            uiState.selectedDate?.let { date ->
                val dateExpenses = viewModel.getExpensesForDate(date)
                item {
                    ExpenseDetailCard(
                        date = date,
                        expenses = dateExpenses,
                        onCategoryChange = viewModel::updateCategory,
                        onSaveMerchantRule = viewModel::saveMerchantRule,
                        onDelete = viewModel::deleteExpense
                    )
                }
            }
        }
    }
}

@Composable
fun MonthSelectorCard(
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
fun CategorySummaryCard(
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

            val sortedCategories = categoryTotals.entries
                .sortedByDescending { it.value }

            sortedCategories.forEach { (category, amount) ->
                val percentage = if (totalAmount > 0) {
                    (amount.toFloat() / totalAmount * 100)
                } else 0f

                CategoryRow(
                    category = category,
                    amount = amount,
                    percentage = percentage
                )
                Spacer(modifier = Modifier.height(12.dp))
            }
        }
    }
}

@Composable
fun DonutChartCard(
    categoryTotals: Map<Category, Int>,
    totalAmount: Int
) {
    if (totalAmount == 0) return

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

@Composable
fun CategoryRow(
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

@Composable
fun CalendarCard(
    year: Int,
    month: Int,
    selectedDate: String?,
    onDateClick: (String) -> Unit,
    getDailyTotal: (String) -> Int
) {
    val daysOfWeek = listOf("일", "월", "화", "수", "목", "금", "토")
    val dayColors = listOf(
        SundayColor, OnSurface, OnSurface, OnSurface,
        OnSurface, OnSurface, SaturdayColor
    )

    val yearMonth = YearMonth.of(year, month)
    val firstDayOfMonth = yearMonth.atDay(1)
    val daysInMonth = yearMonth.lengthOfMonth()
    val startDayOfWeek = firstDayOfMonth.dayOfWeek.value % 7

    val today = LocalDate.now()
    val todayString = today.toString()

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = Surface)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // 요일 헤더
            Row(modifier = Modifier.fillMaxWidth()) {
                daysOfWeek.forEachIndexed { index, day ->
                    Text(
                        text = day,
                        modifier = Modifier.weight(1f),
                        textAlign = TextAlign.Center,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = dayColors[index]
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // 날짜 그리드
            val totalCells = startDayOfWeek + daysInMonth
            val rows = (totalCells + 6) / 7

            for (row in 0 until rows) {
                Row(modifier = Modifier.fillMaxWidth()) {
                    for (col in 0..6) {
                        val cellIndex = row * 7 + col
                        val day = cellIndex - startDayOfWeek + 1

                        if (day in 1..daysInMonth) {
                            val dateString = String.format("%04d-%02d-%02d", year, month, day)
                            val dayTotal = getDailyTotal(dateString)
                            val isSelected = selectedDate == dateString
                            val isToday = dateString == todayString
                            val dayOfWeek = (startDayOfWeek + day - 1) % 7

                            CalendarDay(
                                day = day,
                                total = dayTotal,
                                isSelected = isSelected,
                                isToday = isToday,
                                dayColor = dayColors[dayOfWeek],
                                onClick = { onDateClick(dateString) },
                                modifier = Modifier.weight(1f)
                            )
                        } else {
                            Spacer(modifier = Modifier.weight(1f))
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun CalendarDay(
    day: Int,
    total: Int,
    isSelected: Boolean,
    isToday: Boolean,
    dayColor: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val backgroundColor = when {
        isSelected -> Primary.copy(alpha = 0.1f)
        else -> Color.Transparent
    }

    Column(
        modifier = modifier
            .padding(2.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(backgroundColor)
            .clickable(onClick = onClick)
            .padding(4.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = if (isToday) {
                Modifier
                    .size(24.dp)
                    .clip(CircleShape)
                    .background(Primary)
            } else {
                Modifier.size(24.dp)
            }
        ) {
            Text(
                text = day.toString(),
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                color = if (isToday) Color.White else dayColor
            )
        }

        if (total > 0) {
            Text(
                text = if (total >= 10000) {
                    "${total / 10000}만"
                } else {
                    "%,d".format(total)
                },
                fontSize = 9.sp,
                color = TextSecondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
fun ExpenseDetailCard(
    date: String,
    expenses: List<Expense>,
    onCategoryChange: (String, Category) -> Unit,
    onSaveMerchantRule: (String, Category, Boolean) -> Unit = { _, _, _ -> },
    onDelete: (String) -> Unit = {}
) {
    val parts = date.split("-")
    val month = parts[1].toInt()
    val day = parts[2].toInt()
    val dayOfWeek = LocalDate.parse(date).dayOfWeek.value
    val dayNames = listOf("월", "화", "수", "목", "금", "토", "일")

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
                Text(
                    text = "${month}월 ${day}일 (${dayNames[dayOfWeek - 1]})",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "${"%,d".format(expenses.sumOf { it.amount })}원",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            if (expenses.isEmpty()) {
                Text(
                    text = "지출 내역이 없습니다",
                    color = TextSecondary,
                    modifier = Modifier.padding(vertical = 24.dp)
                )
            } else {
                expenses.forEach { expense ->
                    ExpenseItem(
                        expense = expense,
                        onCategoryChange = { category ->
                            onCategoryChange(expense.id, category)
                        },
                        onSaveMerchantRule = { category ->
                            onSaveMerchantRule(expense.merchant, category, true)
                        },
                        onDelete = { onDelete(expense.id) }
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                }
            }
        }
    }
}

@Composable
fun ExpenseItem(
    expense: Expense,
    onCategoryChange: (Category) -> Unit,
    onSaveMerchantRule: (Category) -> Unit = {},
    onDelete: () -> Unit = {}
) {
    var showCategoryDialog by remember { mutableStateOf(false) }
    var showRememberDialog by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf(false) }
    var selectedCategory by remember { mutableStateOf<Category?>(null) }

    val category = expense.getCategoryEnum()
    val categoryColor = when (category) {
        Category.LIVING -> CategoryLiving
        Category.CHILDCARE -> CategoryChildcare
        Category.FIXED -> CategoryFixed
        Category.FOOD -> CategoryFood
        Category.ETC -> CategoryEtc
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(SurfaceVariant)
            .clickable { showCategoryDialog = true }
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // 카테고리 아이콘
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
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium
            )
        }

        Spacer(modifier = Modifier.width(12.dp))

        // 가맹점명 & 카테고리
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = expense.merchant,
                fontWeight = FontWeight.Medium,
                fontSize = 15.sp
            )
            Text(
                text = "${category.label} · ${expense.getCardTypeEnum().label}",
                fontSize = 12.sp,
                color = TextSecondary
            )
        }

        // 금액
        Text(
            text = "${"%,d".format(expense.amount)}원",
            fontWeight = FontWeight.SemiBold,
            fontSize = 15.sp
        )

        // 삭제 버튼
        IconButton(
            onClick = { showDeleteDialog = true },
            modifier = Modifier.size(32.dp)
        ) {
            Icon(
                Icons.Default.Delete,
                contentDescription = "삭제",
                tint = TextSecondary,
                modifier = Modifier.size(18.dp)
            )
        }
    }

    // 삭제 확인 다이얼로그
    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteDialog = false },
            title = { Text("삭제 확인") },
            text = {
                Text("\"${expense.merchant}\" ${"%,d".format(expense.amount)}원을 삭제하시겠습니까?")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        onDelete()
                        showDeleteDialog = false
                    }
                ) {
                    Text("삭제", color = Color.Red)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = false }) {
                    Text("취소")
                }
            }
        )
    }

    // 카테고리 변경 다이얼로그
    if (showCategoryDialog) {
        AlertDialog(
            onDismissRequest = { showCategoryDialog = false },
            title = { Text("카테고리 변경") },
            text = {
                Column {
                    Category.entries.forEach { cat ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    if (cat != category) {
                                        onCategoryChange(cat)
                                        selectedCategory = cat
                                        showCategoryDialog = false
                                        showRememberDialog = true
                                    } else {
                                        showCategoryDialog = false
                                    }
                                }
                                .padding(vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            val catColor = when (cat) {
                                Category.LIVING -> CategoryLiving
                                Category.CHILDCARE -> CategoryChildcare
                                Category.FIXED -> CategoryFixed
                                Category.FOOD -> CategoryFood
                                Category.ETC -> CategoryEtc
                            }
                            Box(
                                modifier = Modifier
                                    .size(16.dp)
                                    .clip(CircleShape)
                                    .background(catColor)
                            )
                            Spacer(modifier = Modifier.width(12.dp))
                            Text(
                                text = cat.label,
                                fontWeight = if (cat == category) FontWeight.Bold else FontWeight.Normal
                            )
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showCategoryDialog = false }) {
                    Text("취소")
                }
            }
        )
    }

    // "이 가맹점 기억할까요?" 다이얼로그
    if (showRememberDialog && selectedCategory != null) {
        AlertDialog(
            onDismissRequest = { showRememberDialog = false },
            title = { Text("가맹점 기억하기") },
            text = {
                Text(
                    text = "\"${expense.merchant}\"을(를) ${selectedCategory!!.label}(으)로 기억할까요?\n\n" +
                            "다음에 같은 가맹점에서 결제하면 자동으로 ${selectedCategory!!.label}(으)로 분류됩니다."
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        onSaveMerchantRule(selectedCategory!!)
                        showRememberDialog = false
                        selectedCategory = null
                    }
                ) {
                    Text("예")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        showRememberDialog = false
                        selectedCategory = null
                    }
                ) {
                    Text("아니오")
                }
            }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddExpenseDialog(
    selectedDate: String?,
    onDismiss: () -> Unit,
    onConfirm: (merchant: String, amount: Int, category: Category, date: String) -> Unit
) {
    var merchant by remember { mutableStateOf("") }
    var amountText by remember { mutableStateOf("") }
    var selectedCategory by remember { mutableStateOf(Category.ETC) }
    var showCategoryDropdown by remember { mutableStateOf(false) }

    // 날짜 초기값: 선택된 날짜 또는 오늘
    val initialDate = selectedDate ?: LocalDate.now().toString()
    var dateText by remember { mutableStateOf(initialDate) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("지출 추가") },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // 가맹점명
                OutlinedTextField(
                    value = merchant,
                    onValueChange = { merchant = it },
                    label = { Text("가맹점명") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                // 금액
                OutlinedTextField(
                    value = amountText,
                    onValueChange = { amountText = it.filter { c -> c.isDigit() } },
                    label = { Text("금액") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    suffix = { Text("원") },
                    modifier = Modifier.fillMaxWidth()
                )

                // 카테고리 선택
                ExposedDropdownMenuBox(
                    expanded = showCategoryDropdown,
                    onExpandedChange = { showCategoryDropdown = it }
                ) {
                    OutlinedTextField(
                        value = selectedCategory.label,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("카테고리") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = showCategoryDropdown) },
                        modifier = Modifier
                            .menuAnchor()
                            .fillMaxWidth()
                    )
                    ExposedDropdownMenu(
                        expanded = showCategoryDropdown,
                        onDismissRequest = { showCategoryDropdown = false }
                    ) {
                        Category.entries.forEach { category ->
                            DropdownMenuItem(
                                text = { Text(category.label) },
                                onClick = {
                                    selectedCategory = category
                                    showCategoryDropdown = false
                                }
                            )
                        }
                    }
                }

                // 날짜
                OutlinedTextField(
                    value = dateText,
                    onValueChange = { dateText = it },
                    label = { Text("날짜 (YYYY-MM-DD)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val amount = amountText.toIntOrNull() ?: 0
                    if (merchant.isNotBlank() && amount > 0) {
                        onConfirm(merchant, amount, selectedCategory, dateText)
                    }
                },
                enabled = merchant.isNotBlank() && amountText.isNotBlank()
            ) {
                Text("추가")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("취소")
            }
        }
    )
}
