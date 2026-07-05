#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const HOUSEHOLD_ALIASES = {
  iktae: 'TVuRIWvPfF3qoAWChp09',
  '익태네': 'TVuRIWvPfF3qoAWChp09',
  '익태송희네': 'TVuRIWvPfF3qoAWChp09',
  'ttoni-mango': 'ooZmqdvKQTkyvEPMERgs',
  '또니망고네': 'ooZmqdvKQTkyvEPMERgs',
};

const SOURCE_TO_PARSER = {
  KB: 'KBCardParser.kt',
  NH: 'NHPayParser.kt',
  NAVER_PAY: 'NaverPayParser.kt',
  TOSS_BANK: 'TossBankParser.kt',
  KAKAOPAY: 'KakaoPayParser.kt',
  DIGITAL_ONNURI: 'DigitalOnnuriParser.kt',
  PAYBOOC_ISP: 'PayboocISPParser.kt',
  SMS: 'SmsNotificationParser.kt',
  SAMSUNG: 'SamsungCardParser.kt',
  SAMSUNG_CARD: 'SamsungCardParser.kt',
  LOTTE: 'LotteCardParser.kt',
  LOTTE_CARD: 'LotteCardParser.kt',
  GYEONGGI_LOCAL_CURRENCY: 'GyeonggiLocalCurrencyParser.kt',
  DAEJEON_LOCAL_CURRENCY: 'DaejeonLocalCurrencyParser.kt',
  SEJONG_LOCAL_CURRENCY: 'SejongLocalCurrencyParser.kt',
  CITY_GAS_BILL: 'CityGasBillParser.kt',
};

const DEBUG_ONLY_SOURCES = new Set([
  'SHINHAN_CARD',
  'HYUNDAI_CARD',
  'HANA_CARD',
  'WOORI_CARD',
  'IBK_CARD',
  'CITI_CARD',
  'EPOST_BANKING',
  'EPOST_PAY',
  'KAKAO_BANK',
  'K_BANK',
  'SC_BANK',
  'KDB_BANK',
  'IM_BANK',
  'BUSAN_BANK',
  'KYONGNAM_BANK',
  'GWANGJU_BANK',
  'JEONBUK_BANK',
  'JEJU_BANK',
  'SUHYUP_BANK',
  'SUHYUP_PARTNER_BANK',
  'CU_BANK',
  'MG_BANK',
]);

const POSITIVE_MARKER = /(승인|사용|결제|이용|일시불|체크카드|납부|청구서|청구|출금)/;
const NEGATIVE_AMOUNT_CONTEXT = /(캐시백|할인|포인트|적립|잔액|누적|총 보유|입금|받았|혜택|리워드|충전)/;
const CANCELLATION_MARKER = /(취소|승인취소|매출취소|결제취소)/;
const MARKETING_ONLY = /(광고|이벤트|혜택|쿠폰)/;

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const projectRoot = findProjectRoot(process.cwd());
  const projectId = readProjectId(projectRoot);
  const householdId = HOUSEHOLD_ALIASES[options.household] || options.household;
  const toDate = options.to || formatDateKst(Date.now());
  const fromDate = options.from || addDays(toDate, -(options.days - 1));
  const startMillis = kstStartMillis(fromDate);
  const endMillis = kstStartMillis(addDays(toDate, 1)) - 1;

  const { logs, expenses, registeredCards } = await fetchAuditData({
    projectRoot,
    projectId,
    householdId,
    fromDate,
    toDate,
    startMillis,
    endMillis,
    options,
  });

  const candidates = logs
    .map((log) => parseSpendingCandidate(log))
    .filter(Boolean);

  const missing = candidates
    .map((candidate) => {
      const parser = inferParser(candidate);
      return {
        ...candidate,
        matches: findExpenseMatches(candidate, expenses),
        parser,
        registeredCard: inferRegisteredCard({ ...candidate, parser }, registeredCards),
      };
    })
    .filter((candidate) => candidate.matches.length === 0)
    .map((candidate) => ({
      ...candidate,
      reason: inferReason(candidate),
    }));

  const report = {
    householdId,
    fromDate,
    toDate,
    logCount: logs.length,
    expenseCount: expenses.length,
    spendingCandidateCount: candidates.length,
    missingCount: missing.length,
    missing,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printMarkdown(report);
  }
}

async function fetchAuditData(context) {
  try {
    return await fetchAuditDataWithAdmin(context);
  } catch (error) {
    if (!isDefaultCredentialError(error)) {
      throw error;
    }
    return fetchAuditDataWithFirebaseCli(context);
  }
}

async function fetchAuditDataWithAdmin({
  projectRoot,
  projectId,
  householdId,
  fromDate,
  toDate,
  startMillis,
  endMillis,
  options,
}) {
  const admin = loadFirebaseAdmin(projectRoot);

  if (!admin.apps.length) {
    admin.initializeApp(buildFirebaseOptions(admin, projectId, options));
  }

  const db = admin.firestore();
  const [logs, expenses, registeredCards] = await Promise.all([
    fetchNotificationLogs(db, householdId, startMillis, endMillis),
    fetchExpenses(db, householdId, fromDate, toDate),
    fetchRegisteredCards(db, householdId),
  ]);

  return { logs, expenses, registeredCards };
}

async function fetchAuditDataWithFirebaseCli({
  projectRoot,
  projectId,
  householdId,
  fromDate,
  toDate,
  startMillis,
  endMillis,
}) {
  const accessToken = await getFirebaseCliAccessToken(projectRoot);
  const [logs, expenses, registeredCards] = await Promise.all([
    restQueryCollection(projectId, accessToken, 'notification_debug_logs', householdId),
    restQueryCollection(projectId, accessToken, 'expenses', householdId),
    restQueryCollection(projectId, accessToken, 'registered_cards', householdId),
  ]);

  return {
    logs: logs
      .filter((doc) => Number(doc.postedAtMillis || 0) >= startMillis && Number(doc.postedAtMillis || 0) <= endMillis)
      .sort(compareByPostedAt),
    expenses: expenses
      .filter((doc) => typeof doc.date === 'string' && doc.date >= fromDate && doc.date <= toDate)
      .sort(compareExpense),
    registeredCards,
  };
}

function parseArgs(args) {
  const options = {
    household: 'iktae',
    days: 21,
    json: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => args[++index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--household') {
      options.household = next();
    } else if (arg === '--days') {
      options.days = Number(next());
    } else if (arg === '--from') {
      options.from = next();
    } else if (arg === '--to') {
      options.to = next();
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--credentials') {
      options.credentials = next();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.days) || options.days < 1) {
    throw new Error('--days must be a positive number');
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  node .codex/skills/notification-expense-audit/scripts/audit_missing_expenses.js [options]

Options:
  --household iktae|ttoni-mango|<householdId>  Target household. Default: iktae
  --days 21                                    Recent days including --to. Default: 21
  --from YYYY-MM-DD --to YYYY-MM-DD            Explicit date range
  --credentials service-account.json           Firebase service account JSON when ADC is unavailable
  --json                                       Print JSON
  --help                                       Show this help
`);
}

function findProjectRoot(startDir) {
  let current = path.resolve(startDir);

  while (true) {
    if (
      fs.existsSync(path.join(current, '.firebaserc')) &&
      fs.existsSync(path.join(current, 'functions', 'package.json'))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error('Project root not found. Run this script inside Household-account.');
    }
    current = parent;
  }
}

function loadFirebaseAdmin(projectRoot) {
  const modulePath = path.join(projectRoot, 'functions', 'node_modules', 'firebase-admin');
  if (!fs.existsSync(modulePath)) {
    throw new Error('firebase-admin not found. Run: npm --prefix functions install');
  }
  return require(modulePath);
}

function readProjectId(projectRoot) {
  const firebaseRcPath = path.join(projectRoot, '.firebaserc');
  const firebaseRc = JSON.parse(fs.readFileSync(firebaseRcPath, 'utf8'));
  return firebaseRc.projects && firebaseRc.projects.default;
}

function buildFirebaseOptions(admin, projectId, options) {
  const appOptions = { projectId };

  if (options.credentials) {
    const credentialPath = path.resolve(process.cwd(), options.credentials);
    const serviceAccount = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
    appOptions.credential = admin.credential.cert(serviceAccount);
    return appOptions;
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    appOptions.credential = admin.credential.cert(serviceAccount);
  }

  return appOptions;
}

function isDefaultCredentialError(error) {
  const message = String(error && error.message || '');
  return message.includes('Could not load the default credentials') ||
    message.includes('Unable to detect a Project Id') ||
    message.includes('invalid_grant');
}

async function getFirebaseCliAccessToken(projectRoot) {
  const firebaseToolsLib = findFirebaseToolsLib(projectRoot);
  const auth = require(path.join(firebaseToolsLib, 'auth.js'));
  const scopes = require(path.join(firebaseToolsLib, 'scopes.js'));
  const account = auth.getProjectDefaultAccount(projectRoot) || auth.getGlobalDefaultAccount();

  if (!account || !account.tokens || !account.tokens.refresh_token) {
    throw new Error('Firebase CLI account not found. Run: firebase login');
  }

  const token = await auth.getAccessToken(account.tokens.refresh_token, [
    scopes.CLOUD_PLATFORM,
    scopes.FIREBASE_PLATFORM,
  ]);

  if (!token || !token.access_token) {
    throw new Error('Firebase CLI access token not available.');
  }

  return token.access_token;
}

function findFirebaseToolsLib(projectRoot) {
  const candidates = [
    path.join(projectRoot, 'node_modules', 'firebase-tools', 'lib'),
    process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib') : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'auth.js'))) {
      return candidate;
    }
  }

  throw new Error('firebase-tools module not found. Install Firebase CLI or run with --credentials.');
}

async function restQueryCollection(projectId, accessToken, collectionId, householdId) {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runQuery`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'householdId' },
            op: 'EQUAL',
            value: { stringValue: householdId },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Firestore REST query failed (${response.status}) for ${collectionId}: ${body}`);
  }

  const rows = await response.json();
  return rows
    .map((row) => row.document)
    .filter(Boolean)
    .map((document) => ({
      id: decodeURIComponent(String(document.name || '').split('/').pop() || ''),
      ...firestoreFieldsToObject(document.fields || {}),
    }));
}

function firestoreFieldsToObject(fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, firestoreValueToJs(value)])
  );
}

function firestoreValueToJs(value) {
  if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) return Number(value.integerValue);
  if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) return Number(value.doubleValue);
  if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) return Boolean(value.booleanValue);
  if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) return value.timestampValue;
  if (Object.prototype.hasOwnProperty.call(value, 'nullValue')) return null;
  if (Object.prototype.hasOwnProperty.call(value, 'arrayValue')) {
    return (value.arrayValue.values || []).map(firestoreValueToJs);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'mapValue')) {
    return firestoreFieldsToObject(value.mapValue.fields || {});
  }
  return undefined;
}

async function fetchNotificationLogs(db, householdId, startMillis, endMillis) {
  const collection = db.collection('notification_debug_logs');
  const filterFn = (doc) =>
    doc.householdId === householdId &&
    Number(doc.postedAtMillis || 0) >= startMillis &&
    Number(doc.postedAtMillis || 0) <= endMillis;

  try {
    const snapshot = await collection
      .where('householdId', '==', householdId)
      .where('postedAtMillis', '>=', startMillis)
      .where('postedAtMillis', '<=', endMillis)
      .get();
    return snapshot.docs.map(docWithId).sort(compareByPostedAt);
  } catch (error) {
    if (!isIndexOrQueryError(error)) {
      throw error;
    }
    const snapshot = await collection.where('householdId', '==', householdId).get();
    return snapshot.docs.map(docWithId).filter(filterFn).sort(compareByPostedAt);
  }
}

async function fetchExpenses(db, householdId, fromDate, toDate) {
  const collection = db.collection('expenses');
  const filterFn = (doc) =>
    doc.householdId === householdId &&
    typeof doc.date === 'string' &&
    doc.date >= fromDate &&
    doc.date <= toDate;

  try {
    const snapshot = await collection
      .where('householdId', '==', householdId)
      .where('date', '>=', fromDate)
      .where('date', '<=', toDate)
      .get();
    return snapshot.docs.map(docWithId).sort(compareExpense);
  } catch (error) {
    if (!isIndexOrQueryError(error)) {
      throw error;
    }
    const snapshot = await collection.where('householdId', '==', householdId).get();
    return snapshot.docs.map(docWithId).filter(filterFn).sort(compareExpense);
  }
}

async function fetchRegisteredCards(db, householdId) {
  const snapshot = await db.collection('registered_cards')
    .where('householdId', '==', householdId)
    .get();
  return snapshot.docs.map(docWithId);
}

function docWithId(doc) {
  return { id: doc.id, ...doc.data() };
}

function compareByPostedAt(first, second) {
  return Number(first.postedAtMillis || 0) - Number(second.postedAtMillis || 0);
}

function compareExpense(first, second) {
  return `${first.date || ''} ${first.time || ''}`.localeCompare(`${second.date || ''} ${second.time || ''}`);
}

function isIndexOrQueryError(error) {
  const message = String(error && error.message || '');
  return message.includes('index') || message.includes('FAILED_PRECONDITION') || message.includes('requires an index');
}

function parseSpendingCandidate(log) {
  const text = buildFullText(log);
  if (!text) {
    return null;
  }

  if (CANCELLATION_MARKER.test(text)) {
    return null;
  }

  const isPaymentLike = /(승인|결제 완료|결제되었습니다|사용|일시불|납부|청구서|체크)/.test(text);
  if (log.source === 'SMS' && !/(승인|승인취소|사용금액\s*:|카드.*사용)/.test(text)) {
    return null;
  }
  if (/\(광고\)/.test(text)) {
    return null;
  }
  if (/(카드대금 정상 납부|청구서작성일|요금합계|이자 받는 날|넣어드렸어요)/.test(text)) {
    return null;
  }
  if (/(결제금액|결제예정금액|피해지원금 사용안내)/.test(text)) {
    return null;
  }
  if (log.source === 'NH' && /\(지역화폐\s*[\d,]+원\s*사용\)/.test(text)) {
    return null;
  }
  if (log.source === 'TOSS_BANK' && /출금/.test(text) && !/결제/.test(text)) {
    return null;
  }
  if (log.source === 'SMS' && /카드 자동납부 정상승인 안내/.test(text)) {
    return null;
  }
  if (/가승인/.test(text)) {
    return null;
  }
  if (/캐시백/.test(text) && !/(결제|승인|사용)/.test(text)) {
    return null;
  }
  if (/송금/.test(text) && !/(결제|승인|사용|납부|청구)/.test(text)) {
    return null;
  }
  if (/충전되었/.test(text)) {
    return null;
  }

  const amountInfo = pickPaymentAmount(text);
  if (!amountInfo) {
    return null;
  }

  const hasPositiveMarker = POSITIVE_MARKER.test(text);
  const isBill = text.includes('도시가스요금 청구서');
  const isKnownPaymentSource = Boolean(SOURCE_TO_PARSER[log.source]) || DEBUG_ONLY_SOURCES.has(log.source);
  const isMarketingOnly = MARKETING_ONLY.test(text) && !hasPositiveMarker && !isBill;

  if ((!hasPositiveMarker && !isBill && !isKnownPaymentSource) || isMarketingOnly) {
    return null;
  }

  const postedAtMillis = Number(log.postedAtMillis || 0);
  const dateTime = parseDateTime(text, postedAtMillis);
  const merchant = parseMerchant(text, amountInfo.amount);
  const cardRefs = parseCardRefs(text);

  let confidence = 0;
  confidence += amountInfo.score >= 0 ? 2 : 0;
  confidence += hasPositiveMarker ? 2 : 0;
  confidence += isKnownPaymentSource ? 2 : 0;
  confidence += merchant ? 1 : 0;
  confidence += dateTime.time ? 1 : 0;
  confidence -= isMarketingOnly ? 4 : 0;

  if (confidence < 4) {
    return null;
  }

  return {
    logId: log.id,
    packageName: log.packageName || '',
    source: log.source || '',
    memberName: log.memberName || '',
    title: log.title || '',
    date: dateTime.date,
    time: dateTime.time,
    postedDate: formatDateKst(postedAtMillis || Date.now()),
    postedTime: formatTimeKst(postedAtMillis || Date.now()),
    amount: amountInfo.amount,
    merchant,
    cardRefs,
    confidence,
    text,
    snippet: compactText(text).slice(0, 180),
  };
}

function buildFullText(log) {
  if (String(log.fullText || '').trim()) {
    return String(log.fullText || '').trim();
  }

  const candidates = [
    log.title,
    log.text,
    log.bigText,
    ...(Array.isArray(log.textLines) ? log.textLines : []),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  return Array.from(new Set(candidates)).join('\n').trim();
}

function pickPaymentAmount(text) {
  const explicitPatterns = [
    /결제\s*완료\s*([0-9][0-9,]*)\s*원/,
    /^([0-9][0-9,]*)\s*원\s*결제/m,
    /([0-9][0-9,]*)\s*원\s*(?:일시불|체크)(?:\s|$)/,
    /에서\s*([0-9][0-9,]*)\s*원\s*사용/,
    /사용금액\s*:\s*([0-9][0-9,]*)\s*원/,
    /총\s*금액은\s*([0-9][0-9,]*)\s*원/,
    /([0-9][0-9,]*)\s*원이\s*결제/,
    /([0-9][0-9,]*)\s*원을?\s*결제(?:했습니다|했어요|되었습니다|됐어요)/,
  ];

  for (const pattern of explicitPatterns) {
    const match = pattern.exec(text);
    if (match) {
      const amount = Number(match[1].replace(/,/g, ''));
      if (amount > 0) {
        return { amount, score: 10, context: match[0] };
      }
    }
  }

  const matches = Array.from(text.matchAll(/([0-9][0-9,]*)\s*원/g));
  if (matches.length === 0) {
    return null;
  }

  const scored = matches
    .map((match) => {
      const amount = Number(match[1].replace(/,/g, ''));
      const start = Math.max(0, match.index - 24);
      const end = Math.min(text.length, match.index + match[0].length + 24);
      const context = text.slice(start, end);
      let score = 0;

      if (POSITIVE_MARKER.test(context)) score += 4;
      if (NEGATIVE_AMOUNT_CONTEXT.test(context)) score -= 8;
      if (amount > 0) score += 1;

      return { amount, score, context };
    })
    .filter((item) => item.amount > 0);

  if (scored.length === 0) {
    return null;
  }

  scored.sort((first, second) => {
    if (second.score !== first.score) return second.score - first.score;
    return second.amount - first.amount;
  });

  const best = scored[0];
  if (best.score < 0 && !POSITIVE_MARKER.test(text)) {
    return null;
  }
  return best;
}

function parseDateTime(text, postedAtMillis) {
  const postedDate = formatDateKst(postedAtMillis || Date.now());
  const postedYear = Number(postedDate.slice(0, 4));

  const patterns = [
    /(\d{1,2})[./-](\d{1,2})\s+(\d{1,2}):(\d{2})/,
    /(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2}):(\d{2})/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const date = adjustYear(`${postedYear}-${pad2(match[1])}-${pad2(match[2])}`, postedDate);
      return { date, time: `${pad2(match[3])}:${pad2(match[4])}` };
    }
  }

  const amountDateMatch = text.match(/[0-9][0-9,]*\s*원\s+(\d{1,2})[./-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (amountDateMatch) {
    const date = adjustYear(`${postedYear}-${pad2(amountDateMatch[1])}-${pad2(amountDateMatch[2])}`, postedDate);
    const time = amountDateMatch[3] ? `${pad2(amountDateMatch[3])}:${pad2(amountDateMatch[4])}` : formatTimeKst(postedAtMillis || Date.now());
    return { date, time };
  }

  const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
  return {
    date: postedDate,
    time: timeMatch ? `${pad2(timeMatch[1])}:${pad2(timeMatch[2])}` : '',
  };
}

function adjustYear(date, postedDate) {
  const diff = daysBetween(date, postedDate);
  if (diff > 31) {
    return `${Number(date.slice(0, 4)) - 1}${date.slice(4)}`;
  }
  if (diff < -335) {
    return `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`;
  }
  return date;
}

function parseMerchant(text, amount) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const amountPattern = new RegExp(`${escapeRegExp(amount.toLocaleString('ko-KR'))}\\s*원|${amount}\\s*원`);

  const directPatterns = [
    /([^\n]{2,80}?)\s*에서\s*[0-9][0-9,]*\s*원\s*(?:사용|결제|승인|이용)/,
    /(?:가맹점|사용처|결제처|상호)\s*[:：]?\s*([^\n]+)/,
    /(?:토스뱅크\s*체크카드|페이스페이\s*\(토스뱅크\))\s*\|\s*([^\n]+)/,
    /도시가스요금 청구서/,
  ];

  for (const pattern of directPatterns) {
    const match = text.match(pattern);
    if (match) {
      if (pattern.source.includes('도시가스')) {
        const monthMatch = text.match(/(\d{1,2})월\s*도시가스요금/);
        return monthMatch ? `${Number(monthMatch[1])}월 도시가스요금` : '도시가스요금';
      }
      return cleanMerchant(match[1]);
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!amountPattern.test(line) && !/[0-9][0-9,]*\s*원/.test(line)) {
      continue;
    }

    const beforeAmount = line.split(/[0-9][0-9,]*\s*원/)[0].trim();
    if (beforeAmount && !isNoiseLine(beforeAmount)) {
      return cleanMerchant(beforeAmount.replace(/에서$/, ''));
    }

    for (let nextIndex = index + 1; nextIndex < Math.min(lines.length, index + 4); nextIndex += 1) {
      const nextLine = lines[nextIndex];
      if (!isNoiseLine(nextLine)) {
        return cleanMerchant(nextLine);
      }
    }
  }

  const title = lines[0] || '';
  return isNoiseLine(title) ? '' : cleanMerchant(title);
}

function isNoiseLine(line) {
  const value = line.trim();
  if (!value) return true;
  if (/^[0-9][0-9,]*\s*원/.test(value)) return true;
  if (/^\d{1,2}[./-]\d{1,2}\s+\d{1,2}:\d{2}$/.test(value)) return true;
  if (/^\d{1,2}:\d{2}$/.test(value)) return true;
  if (/(승인|사용|결제|체크카드|일시불|누적|잔액|캐시백|할인|광고)/.test(value) && value.length < 24) {
    return true;
  }
  if (/^(삼성|국민|KB|NH|농협|롯데|신한|현대|하나|우리|비씨|BC)[0-9*xX]{0,4}\s*(승인|사용|결제)?$/.test(value)) {
    return true;
  }
  return false;
}

function cleanMerchant(value) {
  return String(value || '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\([^\)]*승인[^\)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function parseCardRefs(text) {
  const refs = [];
  const pattern = /(삼성|국민|KB|비씨|BC|농협|NH|롯데|토스|카카오|신한|현대|하나|우리)\s*[\(\[]?([0-9*xX]{4})?[\)\]]?/gi;
  for (const match of text.matchAll(pattern)) {
    const label = normalizeCardLabel(match[1]);
    const token = normalizeCardToken(match[2] || '');
    if (label || token) {
      refs.push({ label, token });
    }
  }
  return uniqueCardRefs(refs);
}

function uniqueCardRefs(refs) {
  const seen = new Set();
  return refs.filter((ref) => {
    const key = `${ref.label || ''}:${ref.token || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeCardLabel(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return '';
  if (normalized === 'KB') return '국민';
  if (normalized === 'BC') return '비씨';
  if (normalized === 'NH') return '농협';
  return value.trim();
}

function normalizeCardToken(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\*/g, 'x')
    .replace(/[^0-9x]/g, '')
    .slice(-4);
  return normalized || '';
}

function findExpenseMatches(candidate, expenses) {
  const sameAmount = expenses.filter((expense) => Number(expense.amount) === candidate.amount);
  const matches = sameAmount.filter((expense) => {
    const sameDate = expense.date === candidate.date;
    const nearDate = Math.abs(daysBetween(expense.date, candidate.date)) <= 1;
    const merchantMatch = fuzzyIncludes(expense.merchant, candidate.merchant);
    const timeMatch = isNearTime(expense.time, candidate.time, 10);

    if (sameDate && (merchantMatch || timeMatch)) return true;
    if (sameDate && sameAmount.filter((item) => item.date === candidate.date).length === 1) return true;
    if (nearDate && merchantMatch && timeMatch) return true;
    return false;
  });

  return matches.map((expense) => ({
    id: expense.id,
    date: expense.date,
    time: expense.time || '',
    amount: expense.amount,
    merchant: expense.merchant || '',
    cardLastFour: expense.cardLastFour || '',
  }));
}

function fuzzyIncludes(first, second) {
  const a = normalizeText(first);
  const b = normalizeText(second);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^\p{Letter}\p{Number}]/gu, '');
}

function isNearTime(first, second, toleranceMinutes) {
  if (!first || !second) return false;
  const firstMinutes = parseTimeMinutes(first);
  const secondMinutes = parseTimeMinutes(second);
  if (firstMinutes == null || secondMinutes == null) return false;
  return Math.abs(firstMinutes - secondMinutes) <= toleranceMinutes;
}

function parseTimeMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function inferParser(candidate) {
  const parserFile = SOURCE_TO_PARSER[candidate.source];
  if (parserFile) {
    return {
      status: 'has-parser',
      file: `android/app/src/main/java/com/household/account/parser/${parserFile}`,
    };
  }

  if (DEBUG_ONLY_SOURCES.has(candidate.source)) {
    return {
      status: 'debug-only',
      file: '',
    };
  }

  return {
    status: 'no-parser',
    file: '',
  };
}

function inferRegisteredCard(candidate, registeredCards) {
  if (candidate.parser.file.endsWith('CityGasBillParser.kt')) {
    return { status: 'not-required', matched: '' };
  }

  if (!candidate.cardRefs.length) {
    return { status: 'unknown', matched: '' };
  }

  const ownerCards = registeredCards.filter((card) => !candidate.memberName || card.owner === candidate.memberName);
  const matched = ownerCards.find((card) => candidate.cardRefs.some((ref) => cardRefMatches(ref, card)));

  if (matched) {
    return {
      status: 'matched',
      matched: `${matched.owner || ''} ${matched.cardLabel || ''}(${matched.cardLastFour || ''})`.trim(),
    };
  }

  return { status: 'no-match', matched: '' };
}

function cardRefMatches(ref, card) {
  const label = normalizeCardLabel(card.cardLabel || '');
  const token = normalizeCardToken(card.cardLastFour || '');
  const labelMatches = !ref.label || !label || normalizeText(ref.label) === normalizeText(label);
  const tokenMatches = !ref.token || !token || tokenMatchesWithMask(ref.token, token);
  return labelMatches && tokenMatches;
}

function tokenMatchesWithMask(first, second) {
  if (!first || !second || first.length !== second.length) return false;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index] && first[index] !== 'x' && second[index] !== 'x') {
      return false;
    }
  }
  return true;
}

function inferReason(candidate) {
  if (candidate.parser.status === 'no-parser' || candidate.parser.status === 'debug-only') {
    return 'parser-missing';
  }
  if (candidate.registeredCard.status === 'no-match') {
    return 'registered-card-missing';
  }
  return 'parser-format-or-save-blocked';
}

function printMarkdown(report) {
  console.log(`# Notification expense audit`);
  console.log('');
  console.log(`- householdId: \`${report.householdId}\``);
  console.log(`- period: \`${report.fromDate}\` ~ \`${report.toDate}\``);
  console.log(`- notification logs: ${report.logCount}`);
  console.log(`- expenses: ${report.expenseCount}`);
  console.log(`- spending candidates: ${report.spendingCandidateCount}`);
  console.log(`- missing spending notifications: ${report.missingCount}`);
  console.log('');

  if (report.missing.length === 0) {
    console.log('No missing spending notifications found.');
    return;
  }

  console.log(`## Missing spending notifications`);
  console.log('');
  console.log('| # | date | time | amount | merchant | source | member | parser | registeredCard | reason | logId |');
  console.log('|---|---|---|---:|---|---|---|---|---|---|---|');
  report.missing.forEach((item, index) => {
    console.log([
      `| ${index + 1}`,
      item.date,
      item.time || item.postedTime || '',
      item.amount.toLocaleString('ko-KR'),
      escapeTable(item.merchant || '(unknown)'),
      escapeTable(item.source || ''),
      escapeTable(item.memberName || ''),
      escapeTable(item.parser.status),
      escapeTable(item.registeredCard.status),
      escapeTable(item.reason),
      `\`${item.logId}\` |`,
    ].join(' | '));
  });

  console.log('');
  console.log('## Details');
  console.log('');
  report.missing.forEach((item, index) => {
    console.log(`### ${index + 1}. ${item.date} ${item.time || item.postedTime || ''} ${item.amount.toLocaleString('ko-KR')}원`);
    console.log('');
    console.log(`- source: \`${item.source || ''}\` / package: \`${item.packageName || ''}\``);
    console.log(`- parser: ${item.parser.file ? `\`${item.parser.file}\`` : item.parser.status}`);
    console.log(`- registeredCard: ${item.registeredCard.matched || item.registeredCard.status}`);
    console.log(`- snippet: ${item.snippet}`);
    console.log('');
  });
}

function escapeTable(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function kstStartMillis(date) {
  return new Date(`${date}T00:00:00+09:00`).getTime();
}

function formatDateKst(timestamp) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));

  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`;
}

function formatTimeKst(timestamp) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(timestamp));

  return `${part(parts, 'hour')}:${part(parts, 'minute')}`;
}

function part(parts, type) {
  return parts.find((item) => item.type === type).value;
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysBetween(first, second) {
  const firstTime = Date.parse(`${first}T00:00:00Z`);
  const secondTime = Date.parse(`${second}T00:00:00Z`);
  return Math.round((firstTime - secondTime) / 86400000);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}
