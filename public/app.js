import { allowedEmails, firebaseConfig } from "./firebase-config.js";

const householdId = "default-household";
const localKey = "couple-budget-state-v1";
const defaultTransactionCategories = ["월급", "주거", "용돈", "적금", "교통", "통신", "생활비", "기타"];
const defaultAllocationCategories = ["주거", "용돈", "적금", "교통", "통신", "생활비"];

const emptyState = {
  transactions: [],
  transactionCategories: [...defaultTransactionCategories],
  allocations: [],
  allocationCategories: [...defaultAllocationCategories],
  distributions: [],
  deposits: [],
  housingRepayments: [],
  backups: [],
  housing: { jeonse: 0, ownFund: 0, loan: 0, interest: 0 }
};

let state = structuredClone(emptyState);
let saveState = () => localStorage.setItem(localKey, JSON.stringify(state));
let remoteReady = false;
let authApi = null;
let remoteSnapshotHadUserData = false;

const titles = {
  dashboard: ["대시보드", "월별 수입, 지출, 자산 흐름을 확인합니다."],
  transactions: ["거래 내역", "월급 통장과 개인카드 사용 내역을 입력하고 관리합니다."],
  budgets: ["고정비 지출", "월급 통장에서 고정비와 생활비로 분배되는 금액을 처리합니다."],
  settlements: ["생활비 정산", "생활비 개인카드 선결제분을 부부 기준으로 정산합니다."],
  deposits: ["예적금", "예금과 적금의 가입일, 만기일, 이율, 금액을 관리합니다."],
  housing: ["주택 자금", "전세금, 주택 자금, 대출금, 월 이자를 관리합니다."],
  assets: ["전체 자산", "공통 통장 잔여, 예적금, 주택 순자산을 합산합니다."],
  settings: ["설정", "동기화와 가구 기준 설정을 관리합니다."]
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;"
})[char]);
const won = (value) => `${Math.round(value || 0).toLocaleString("ko-KR")}원`;
const compactWon = (value) => {
  const number = Math.round(value || 0);
  if (Math.abs(number) >= 100000000) {
    const formatted = (number / 100000000).toFixed(number % 100000000 === 0 ? 0 : 1);
    return `${formatted}억`;
  }
  if (Math.abs(number) >= 10000) {
    return `${Math.round(number / 10000).toLocaleString("ko-KR")}만`;
  }
  return won(number);
};
const numberFromMoney = (value) => Number(String(value ?? "").replace(/[^0-9]/g, "")) || 0;
const moneyOrFallback = (value, fallback) => String(value ?? "").trim() ? numberFromMoney(value) : numberFromMoney(fallback);
const moneyInputValue = (value) => {
  const number = numberFromMoney(value);
  return number ? number.toLocaleString("ko-KR") : "";
};
const monthOf = (date) => date.slice(0, 7);
const dayNumber = (value) => {
  const day = Number(String(value ?? "").replace(/[^0-9]/g, ""));
  return day >= 1 && day <= 31 ? day : "";
};
const currentSystemMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};
const newId = () => crypto.randomUUID();

function stateHasUserData(source = state) {
  return [
    source.transactions,
    source.allocations,
    source.deposits,
    source.housingRepayments
  ].some((items) => Array.isArray(items) && items.length > 0)
    || numberFromMoney(source.housing?.jeonse) > 0
    || numberFromMoney(source.housing?.ownFund) > 0
    || numberFromMoney(source.housing?.loan) > 0
    || numberFromMoney(source.housing?.interest) > 0;
}

function stateHasBackup(source = state) {
  return Array.isArray(source.backups) && source.backups.length > 0;
}

function normalizeState() {
  state.transactions ||= [];
  const storedTransactionCategories = Array.isArray(state.transactionCategories) ? state.transactionCategories : null;
  state.transactionCategories = [
    ...new Set((storedTransactionCategories ?? [
      ...defaultTransactionCategories,
      ...state.transactions.map((item) => item.category)
    ]).filter(Boolean))
  ];
  state.allocations ||= [];
  state.allocations.forEach((item) => {
    item.id ||= newId();
    item.detail ||= "";
    item.owner ||= "";
    item.bank ||= "";
    item.account ||= "";
    item.transferDay = dayNumber(item.transferDay || item.autoTransferDay);
  });
  const storedAllocationCategories = Array.isArray(state.allocationCategories) ? state.allocationCategories : null;
  state.allocationCategories = [
    ...new Set((storedAllocationCategories ?? [
      ...defaultAllocationCategories,
      ...state.allocations.map((item) => item.category)
    ]).filter(Boolean))
  ];
  state.distributions ||= [];
  state.deposits ||= [];
  refreshCalculatedDepositAmounts();
  state.housingRepayments ||= [];
  state.backups ||= [];
  state.housing ||= { jeonse: 0, ownFund: 0, loan: 0, interest: 0 };
  state.transactions.forEach((item) => {
    if (item.payer === "배우자") item.payer = "정윤희";
  });
}

async function initSync() {
  if (!firebaseConfig) {
    const local = localStorage.getItem(localKey);
    if (local) state = JSON.parse(local);
    normalizeState();
    $("#authGate").classList.add("hidden");
    $("#syncTitle").textContent = "로컬 모드";
    $("#syncDescription").textContent = "Firebase 설정 전까지 이 기기에만 저장됩니다.";
    return;
  }

  normalizeState();

  try {
    const appMod = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js");
    const authMod = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js");
    const dbMod = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js");
    const app = appMod.initializeApp(firebaseConfig);
    const auth = authMod.getAuth(app);
    const db = dbMod.getFirestore(app);
    const docRef = dbMod.doc(db, "households", householdId);
    const provider = new authMod.GoogleAuthProvider();

    authApi = {
      login: async () => {
        try {
          return await authMod.signInWithPopup(auth, provider);
        } catch (error) {
          if (["auth/popup-blocked", "auth/popup-closed-by-user", "auth/operation-not-supported-in-this-environment"].includes(error.code)) {
            return authMod.signInWithRedirect(auth, provider);
          }
          throw error;
        }
      },
      logout: () => authMod.signOut(auth)
    };

    saveState = async () => {
      if (remoteSnapshotHadUserData && !stateHasUserData(state) && !stateHasBackup(state)) {
        throw new Error("데이터가 있는 Firestore 문서를 빈 상태로 덮어쓰는 저장을 차단했습니다.");
      }
      await dbMod.setDoc(docRef, state);
      remoteSnapshotHadUserData = stateHasUserData(state);
    };

    authMod.onAuthStateChanged(auth, async (user) => {
      const email = user?.email || "";
      const allowed = user && allowedEmails.includes(email);

      if (!allowed) {
        $("#authGate").classList.remove("hidden");
        $("#logoutButton").classList.add("hidden");
        $("#syncTitle").textContent = "로그인 필요";
        $("#syncDescription").textContent = "허용된 부부 계정만 사용할 수 있습니다.";
        $("#authMessage").textContent = user ? `${email} 계정은 허용 목록에 없습니다.` : "";
        if (user) await authMod.signOut(auth);
        return;
      }

      $("#authGate").classList.add("hidden");
      $("#logoutButton").classList.remove("hidden");
      $("#syncTitle").textContent = "실시간 동기화";
      $("#syncDescription").textContent = `${email} 계정으로 접속 중입니다.`;

      dbMod.onSnapshot(docRef, async (snapshot) => {
        if (snapshot.exists()) {
          state = snapshot.data();
          normalizeState();
          remoteSnapshotHadUserData = stateHasUserData(state);
        } else {
          await saveState();
        }
        render();
      });
    });

    remoteReady = true;
  } catch (error) {
    $("#authGate").classList.add("hidden");
    $("#syncTitle").textContent = "동기화 오류";
    $("#syncDescription").textContent = "Firebase 설정을 확인하세요. 현재는 로컬 저장입니다.";
    console.error(error);
  }
}

function currentMonth() {
  return $("#monthSelect").value || currentSystemMonth();
}

function monthTransactions() {
  return state.transactions.filter((item) => monthOf(item.date) === currentMonth());
}

function monthRangeEndingAt(endMonth, limit = 12) {
  const [year, month] = endMonth.split("-").map(Number);
  return Array.from({ length: limit }, (_, index) => {
    const date = new Date(year, month - 1 - (limit - 1 - index), 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
}

function recentMonthsWithData(limit = 12) {
  const range = monthRangeEndingAt(currentMonth(), limit);
  const monthsWithData = new Set(state.transactions.map((item) => monthOf(item.date)));
  return range.filter((month) => monthsWithData.has(month));
}

function recentTransactions(limit = 12) {
  const months = new Set(recentMonthsWithData(limit));
  return state.transactions.filter((item) => months.has(monthOf(item.date)));
}

function depositActiveInMonth(deposit, month) {
  const startMonth = deposit.startDate ? monthOf(deposit.startDate) : "";
  const maturityMonth = deposit.maturityDate ? monthOf(deposit.maturityDate) : "";
  return (!startMonth || startMonth <= month) && (!maturityMonth || month <= maturityMonth);
}

function monthIndex(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return year * 12 + monthNumber;
}

function minMonth(first, second) {
  if (!first) return second;
  if (!second) return first;
  return monthIndex(first) <= monthIndex(second) ? first : second;
}

function elapsedMonthsInclusive(startMonth, endMonth) {
  if (!startMonth || !endMonth || monthIndex(endMonth) < monthIndex(startMonth)) return 0;
  return monthIndex(endMonth) - monthIndex(startMonth) + 1;
}

function depositInputAmount(deposit) {
  return numberFromMoney(deposit.amount);
}

function depositUsesCalculatedValue(deposit) {
  return deposit.calculationType === "subscription";
}

function depositContributionForMonth(deposit, month) {
  const amount = depositInputAmount(deposit);
  const startMonth = deposit.startDate ? monthOf(deposit.startDate) : "";
  if (!amount || !startMonth) return 0;

  if (!depositUsesCalculatedValue(deposit)) {
    return startMonth === month ? amount : 0;
  }

  if (deposit.kind === "적금") {
    return depositActiveInMonth(deposit, month) ? amount : 0;
  }
  return startMonth === month ? amount : 0;
}

function depositCurrentAmount(deposit, month = currentSystemMonth()) {
  const amount = depositInputAmount(deposit);
  const startMonth = deposit.startDate ? monthOf(deposit.startDate) : "";
  if (!amount) return 0;

  if (!depositUsesCalculatedValue(deposit)) {
    return amount;
  }
  if (!startMonth || monthIndex(month) < monthIndex(startMonth)) {
    return 0;
  }
  if (deposit.kind !== "적금") {
    return amount;
  }

  const maturityMonth = deposit.maturityDate ? monthOf(deposit.maturityDate) : "";
  const endMonth = minMonth(month, maturityMonth || month);
  return amount * elapsedMonthsInclusive(startMonth, endMonth);
}

function depositSavedCurrentAmount(deposit, month = currentSystemMonth()) {
  return Math.round(depositCurrentAmount(deposit, month));
}

function refreshCalculatedDepositAmounts(month = currentSystemMonth()) {
  state.deposits.forEach((deposit) => {
    deposit.currentAmount = depositSavedCurrentAmount(deposit, month);
  });
}

function totalDepositValue(month = currentSystemMonth()) {
  return state.deposits.reduce((total, item) => total + depositCurrentAmount(item, month), 0);
}

function savingsForMonth(month) {
  return state.deposits
    .reduce((total, item) => total + depositContributionForMonth(item, month), 0);
}

function recentDashboardMonths(limit = 12) {
  const range = monthRangeEndingAt(currentMonth(), limit);
  const monthsWithData = new Set(state.transactions.map((item) => monthOf(item.date)));
  state.deposits.forEach((item) => {
    range.forEach((month) => {
      if (depositContributionForMonth(item, month) > 0) monthsWithData.add(month);
    });
  });
  return range.filter((month) => monthsWithData.has(month));
}

function sum(items, predicate) {
  return items.filter(predicate).reduce((total, item) => total + numberFromMoney(item.amount), 0);
}

function assetParts() {
  const tx = monthTransactions();
  const income = sum(tx, (item) => item.type === "income");
  const expense = sum(tx, (item) => item.type === "expense" && item.payer === "공용 통장");
  const sharedCash = income - expense;
  const deposits = totalDepositValue();
  const housingNet = Math.max(0, numberFromMoney(state.housing.jeonse) - loanRemaining());
  return { sharedCash, deposits, housingNet, total: sharedCash + deposits + housingNet };
}

function totalLoanRepayment() {
  return state.housingRepayments.reduce((total, item) => total + numberFromMoney(item.amount), 0);
}

function loanRemaining() {
  return Math.max(0, numberFromMoney(state.housing.loan) - totalLoanRepayment());
}

function renderMonthSelect() {
  const months = [...new Set(state.transactions.map((item) => monthOf(item.date)))].sort().reverse();
  if (months.length === 0) months.unshift(currentSystemMonth());
  const previous = $("#monthSelect").value;
  $("#monthSelect").innerHTML = months.map((month) => `<option value="${month}">${month}</option>`).join("");
  $("#monthSelect").value = previous && months.includes(previous) ? previous : months[0];
}

function renderMetrics() {
  const tx = monthTransactions();
  const income = sum(tx, (item) => item.type === "income");
  const expense = sum(tx, (item) => item.type === "expense");
  const assets = assetParts();
  $("#incomeTotal").textContent = won(income);
  $("#expenseTotal").textContent = won(expense);
  $("#balanceTotal").textContent = won(income - expense);
  $("#assetTotal").textContent = won(assets.total);
  $("#fullAssetValue").textContent = won(assets.total);
  $("#sharedCashValue").textContent = won(assets.sharedCash);
  $("#depositValue").textContent = won(assets.deposits);
  $("#housingNetValue").textContent = won(assets.housingNet);
}

function renderMonthlyChart() {
  const months = recentDashboardMonths(12);
  if (months.length === 0) {
    $("#monthlyChart").innerHTML = `<p class="muted">표시할 월별 수입, 지출, 저축 데이터가 없습니다.</p>`;
    return;
  }
  const rows = months.map((month) => {
    const tx = state.transactions.filter((item) => monthOf(item.date) === month);
    return {
      month,
      income: sum(tx, (item) => item.type === "income"),
      expense: sum(tx, (item) => item.type === "expense"),
      saving: savingsForMonth(month)
    };
  });
  const max = Math.max(1, ...rows.flatMap((row) => [row.income, row.expense, row.saving]));
  const barWidth = (value) => value > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  $("#monthlyChart").innerHTML = `
    <div class="monthly-chart" aria-label="월별 수입, 지출, 저축">
      <div class="monthly-chart-head">
        <span>월</span>
        <span>수입 / 지출 / 저축</span>
      </div>
      ${rows.map((row) => {
        const series = [
          ["income", "수입", row.income],
          ["expense", "지출", row.expense],
          ["saving", "저축", row.saving]
        ];
        return `
          <div class="monthly-row">
            <strong class="monthly-label">${row.month.slice(2).replace("-", ".")}</strong>
            <div class="monthly-series">
              ${series.map(([type, label, value]) => `
                <div class="monthly-bar-row">
                  <span class="monthly-bar-name">${label}</span>
                  <span class="monthly-track" title="${escapeHtml(`${label} ${won(value)}`)}">
                    <i class="${type}-bar" style="width:${barWidth(value)}%"></i>
                  </span>
                  <strong class="monthly-value">${compactWon(value)}</strong>
                </div>
              `).join("")}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function categoriesForScope(scope) {
  return scope === "allocations" ? state.allocationCategories : state.transactionCategories;
}

function categoryScopeLabel(scope) {
  return scope === "allocations" ? "고정비 지출" : "거래 내역";
}

function renderCategorySelect(select, categories) {
  if (!select) return;
  const previous = select.value;
  select.innerHTML = categories
    .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
    .join("");
  select.value = previous && categories.includes(previous) ? previous : categories[0] || "";
}

function renderCategoryControls() {
  renderCategorySelect($("#transactionCategorySelect"), state.transactionCategories);
  renderCategorySelect($("#allocationCategorySelect"), state.allocationCategories);

  const list = $("#categoryEditList");
  if (!list) return;

  const scope = $("#categoryScope")?.value || "transactions";
  const categories = categoriesForScope(scope);
  list.innerHTML = categories.map((category, index) => `
    <div class="item">
      <div class="item-row category-edit-row">
        <input value="${escapeHtml(category)}" data-category-edit-input="${index}" aria-label="${escapeHtml(category)} 항목명">
        <div class="item-actions">
          <button class="btn" data-update-category-index="${index}">수정 저장</button>
          <button class="delete-btn" data-delete-category-index="${index}">제거</button>
        </div>
      </div>
    </div>
  `).join("");
}

function allocationTitle(item) {
  return item.detail ? `${item.category} · ${item.detail}` : item.category;
}

function allocationMeta(item) {
  return [
    item.owner || "해당자 미지정",
    item.bank,
    item.account,
    item.transferDay ? `매월 ${item.transferDay}일` : ""
  ].filter(Boolean).join(" · ");
}

function allocationDistributionMemo(item) {
  return `${allocationTitle(item)} 분배${item.owner ? ` · ${item.owner}` : ""}`;
}

function allocationDefaultDate(item) {
  const day = dayNumber(item.transferDay) || 1;
  const [year, month] = currentMonth().split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `${currentMonth()}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function renderLists() {
  $("#allocationList").innerHTML = state.allocations.map((item) => `
    <div class="item">
      <div class="item-row"><strong>${escapeHtml(allocationTitle(item))}</strong><span>${won(item.amount)}</span></div>
      <span class="muted">${escapeHtml(allocationMeta(item))}</span>
    </div>
  `).join("");

  $("#budgetList").innerHTML = state.allocations.map((item) => {
    const done = state.distributions.find((entry) =>
      entry.month === currentMonth()
      && (entry.allocationId === item.id || (!entry.allocationId && entry.category === item.category))
    );
    return `
      <div class="item ${done ? "completed" : ""}">
        <div class="item-row">
          <label class="check-row">
            <input type="checkbox" data-open-distribution="${item.id}" ${done ? "checked disabled" : ""}>
            <strong>${escapeHtml(allocationTitle(item))}</strong>
          </label>
          <span>${won(item.amount)}</span>
        </div>
        <span class="muted">${escapeHtml(allocationMeta(item))}</span>
        <div class="item-actions">
          <button class="btn" data-edit-allocation="${item.id}">수정</button>
          <button class="delete-btn" data-delete-allocation="${item.id}">삭제</button>
        </div>
        ${done
          ? `<span class="status-pill">${done.date} 분배 완료</span>`
          : `<div class="distribution-actions" data-date-panel="${item.id}">
              <input type="date" data-distribution-date="${item.id}" value="${allocationDefaultDate(item)}">
              <button class="btn primary" data-confirm-distribution="${item.id}">확인</button>
            </div>`
        }
      </div>
    `;
  }).join("");

  const recent = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  $("#recentTransactions").innerHTML = recent.map((item) => `
    <div class="item">
      <div class="item-row"><strong>${item.memo}</strong><span class="${item.type === "income" ? "amount-income" : "amount-expense"}">${item.type === "income" ? "+" : "-"}${won(item.amount)}</span></div>
      <span class="muted">${item.date} · ${item.category} · ${item.payer}</span>
    </div>
  `).join("");
}

function renderTransactions() {
  const keyword = $("#transactionSearch").value.trim();
  const items = recentTransactions(12)
    .filter((item) => !keyword || `${item.category} ${item.memo} ${item.payer}`.includes(keyword))
    .sort((a, b) => b.date.localeCompare(a.date));
  $("#transactionTable").innerHTML = items.map((item) => `
    <tr>
      <td>${item.date}</td>
      <td>${item.type === "income" ? "수입" : "지출"}</td>
      <td>${item.category}</td>
      <td>${item.memo}</td>
      <td>${item.payer}</td>
      <td class="right ${item.type === "income" ? "amount-income" : "amount-expense"}">${item.type === "income" ? "+" : "-"}${won(item.amount)}</td>
      <td>
        <button class="btn" data-edit-transaction="${item.id}">수정</button>
        <button class="delete-btn" data-delete-transaction="${item.id}">삭제</button>
      </td>
    </tr>
  `).join("");
}

function renderSettlement() {
  const items = monthTransactions().filter((item) => item.type === "expense" && item.category === "생활비" && item.payer !== "공용 통장");
  const taewan = sum(items, (item) => item.payer === "김태완");
  const partner = sum(items, (item) => item.payer === "정윤희");
  const total = taewan + partner;
  const each = total / 2;
  const diff = Math.abs(taewan - each);
  const direction = taewan > partner ? "정윤희 → 김태완" : "김태완 → 정윤희";
  $("#prepaidTotal").textContent = won(total);
  $("#taewanPaid").textContent = won(taewan);
  $("#partnerPaid").textContent = won(partner);
  $("#settlementAmount").textContent = `${direction} ${won(diff)}`;
  $("#settlementSummary").innerHTML = `<div class="item"><strong>${direction}</strong><span class="muted">${won(diff)} 이체 필요</span></div>`;
  $("#settlementItems").innerHTML = items.map((item) => `
    <div class="item">
      <div class="item-row"><strong>${item.memo}</strong><span>${won(item.amount)}</span></div>
      <span class="muted">${item.date} · ${item.payer}</span>
      <div class="item-actions">
        <button class="btn" data-edit-settlement="${item.id}">수정</button>
        <button class="delete-btn" data-delete-transaction="${item.id}">삭제</button>
      </div>
    </div>
  `).join("");
}

function renderDeposits() {
  $("#depositTable").innerHTML = state.deposits.map((item) => `
    <tr>
      <td>${item.name}</td><td>${item.owner || "미지정"}</td><td>${item.kind}</td><td>${item.startDate}</td><td>${item.maturityDate}</td><td>${item.rate}%</td>
      <td class="right">${won(depositInputAmount(item))}</td>
      <td class="right">${won(item.currentAmount ?? depositCurrentAmount(item))}</td>
      <td>
        <button class="btn" data-edit-deposit="${item.id}">수정</button>
        <button class="delete-btn" data-delete-deposit="${item.id}">삭제</button>
      </td>
    </tr>
  `).join("");
}

function renderHousing() {
  $("#jeonseValue").textContent = won(state.housing.jeonse);
  $("#ownFundValue").textContent = won(state.housing.ownFund);
  $("#loanValue").textContent = won(loanRemaining());
  $("#interestValue").textContent = won(state.housing.interest);
  fillHousingForm();
  $("#loanRepaymentList").innerHTML = state.housingRepayments
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((item) => `
      <div class="item">
        <div class="item-row"><strong>${item.date}</strong><span>${won(item.amount)}</span></div>
        <span class="muted">${item.memo || "대출금 상환"}</span>
        <div class="item-actions">
          <button class="btn" data-edit-loan-repayment="${item.id}">수정</button>
          <button class="delete-btn" data-delete-loan-repayment="${item.id}">삭제</button>
        </div>
      </div>
    `).join("");
}

function renderBackupInfo() {
  const backup = latestBackup();
  const restoreButton = $("#restoreBackupButton");
  if (!backup) {
    $("#backupInfo").textContent = "백업 없음";
    restoreButton.disabled = true;
    return;
  }
  const createdAt = new Date(backup.createdAt).toLocaleString("ko-KR");
  $("#backupInfo").textContent = `최근 백업: ${createdAt} · ${backup.reason}`;
  restoreButton.disabled = false;
}

function renderAssetChart() {
  const months = recentMonthsWithData(12);
  if (months.length === 0) {
    $("#assetChart").innerHTML = `<p class="muted">표시할 자산 흐름 데이터가 없습니다.</p>`;
    return;
  }
  const assets = assetParts();
  const points = months.map((_, index) => assets.total - (months.length - index - 1) * 2400000);
  const max = Math.max(...points);
  const min = Math.min(...points);
  const spread = Math.max(1, max - min);
  const poly = points.map((value, index) => {
    const x = 40 + index * (720 / Math.max(1, points.length - 1));
    const y = 205 - ((value - min) / spread) * 155;
    return `${x},${y}`;
  }).join(" ");
  $("#assetChart").innerHTML = `
    <svg viewBox="0 0 800 240" role="img" aria-label="전체 자산 흐름">
      <polyline points="${poly}" fill="none" stroke="#315da8" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"></polyline>
      ${months.map((month, index) => `<text x="${32 + index * (720 / Math.max(1, months.length - 1))}" y="228" fill="#66717d" font-size="18">${Number(month.slice(5))}월</text>`).join("")}
    </svg>
  `;
}

function render() {
  refreshCalculatedDepositAmounts();
  renderMonthSelect();
  renderMetrics();
  renderMonthlyChart();
  renderCategoryControls();
  renderLists();
  renderTransactions();
  renderSettlement();
  renderDeposits();
  renderHousing();
  renderAssetChart();
  renderBackupInfo();
}

function setView(view) {
  $$(".nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $$(".view").forEach((panel) => panel.classList.remove("active-view"));
  $(`#${view}View`).classList.add("active-view");
  $("#viewTitle").textContent = titles[view][0];
  $("#viewDescription").textContent = titles[view][1];
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function stateWithoutBackups(source = state) {
  const snapshot = structuredClone(source);
  delete snapshot.backups;
  return snapshot;
}

function makeBackup(reason) {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    reason,
    data: stateWithoutBackups()
  };
}

function withNewBackup(reason) {
  return [makeBackup(reason), ...(state.backups || [])].slice(0, 5);
}

function latestBackup() {
  return state.backups?.[0] || null;
}

function fillForm(form, values) {
  Object.entries(values).forEach(([key, value]) => {
    const field = form.elements[key];
    if (field) field.value = value ?? "";
  });
}

function resetEditForm(form, submitButton, cancelButton, submitText) {
  form.reset();
  if (form.elements.id) form.elements.id.value = "";
  if (form.elements.originalCategory) form.elements.originalCategory.value = "";
  submitButton.textContent = submitText;
  cancelButton.classList.add("hidden");
}

function fillHousingForm() {
  const form = $("#housingForm");
  if (!form || form.contains(document.activeElement)) return;
  ["jeonse", "ownFund", "loan", "interest"].forEach((name) => {
    if (form.elements[name]) form.elements[name].value = moneyInputValue(state.housing[name]);
  });
}

function completeDistribution(allocationId, date) {
  const allocation = state.allocations.find((item) => item.id === allocationId || item.category === allocationId);
  if (!allocation || !date) return;

  const alreadyDone = state.distributions.some((entry) =>
    entry.month === currentMonth()
    && (entry.allocationId === allocation.id || (!entry.allocationId && entry.category === allocation.category))
  );
  if (alreadyDone) return;

  const transactionId = crypto.randomUUID();
  state.distributions.push({ month: currentMonth(), allocationId: allocation.id, category: allocation.category, date, transactionId });
  state.transactions.push({
    id: transactionId,
    date,
    type: "expense",
    category: allocation.category,
    payer: "공용 통장",
    memo: allocationDistributionMemo(allocation),
    amount: numberFromMoney(allocation.amount)
  });
}

function renameCategoryReferences(scope, previous, next) {
  if (scope === "transactions") {
    state.transactions.forEach((item) => {
      if (item.category === previous) item.category = next;
    });
    return;
  }

  state.allocations.forEach((item) => {
    if (item.category === previous) item.category = next;
  });
  state.distributions.forEach((item) => {
    if (item.category !== previous) return;
    item.category = next;
    const transaction = state.transactions.find((tx) => tx.id === item.transactionId);
    if (transaction) {
      transaction.category = next;
      const allocation = state.allocations.find((entry) => entry.category === next);
      transaction.memo = allocation ? allocationDistributionMemo(allocation) : `${next} 분배`;
    }
  });
}

async function persist() {
  await saveState();
  if (!remoteReady) render();
}

function bindEvents() {
  $$(".nav button").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $("#monthSelect").addEventListener("change", render);
  $("#transactionSearch").addEventListener("input", renderTransactions);
  $("#categoryScope").addEventListener("change", renderCategoryControls);
  $("#categoryForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    const scope = $("#categoryScope").value;
    const categories = categoriesForScope(scope);
    const category = data.category.trim();
    if (!category) return;
    if (categories.includes(category)) {
      event.currentTarget.reset();
      return;
    }
    categories.push(category);
    event.currentTarget.reset();
    await persist();
  });
  $("#resetButton").addEventListener("click", async () => {
    const confirmed = confirm("현재 데이터를 백업한 뒤 모든 가계부 데이터를 빈 상태로 초기화할까요?");
    if (!confirmed) return;
    const typed = prompt("초기화를 진행하려면 '초기화'를 입력하세요.");
    if (typed !== "초기화") return;
    const backups = withNewBackup("전체 초기화 전 백업");
    state = structuredClone(emptyState);
    state.backups = backups;
    normalizeState();
    await persist();
  });
  $("#restoreBackupButton").addEventListener("click", async () => {
    const backup = latestBackup();
    if (!backup) return;
    const createdAt = new Date(backup.createdAt).toLocaleString("ko-KR");
    const confirmed = confirm(`${createdAt} 백업으로 복원할까요? 현재 데이터도 복원 전 백업으로 저장됩니다.`);
    if (!confirmed) return;
    const restorePoint = makeBackup("백업 복원 전 백업");
    const previousBackups = state.backups || [];
    state = structuredClone(backup.data);
    state.backups = [restorePoint, ...previousBackups].slice(0, 5);
    normalizeState();
    await persist();
  });
  $("#loginButton").addEventListener("click", async () => {
    if (!authApi) return;
    $("#authMessage").textContent = "";
    try {
      await authApi.login();
    } catch (error) {
      const messages = {
        "auth/configuration-not-found": "Firebase Authentication이 아직 활성화되지 않았습니다. Firebase 콘솔에서 Authentication을 시작하고 Google 로그인을 켜야 합니다.",
        "auth/operation-not-allowed": "Google 로그인 제공자가 비활성화되어 있습니다. Firebase Authentication의 Google 제공자를 활성화하세요.",
        "auth/unauthorized-domain": "현재 접속 도메인이 Firebase Auth 허용 도메인에 없습니다. 배포 URL을 사용하거나 Authorized domains에 현재 도메인을 추가하세요."
      };
      $("#authMessage").textContent = messages[error.code] || `로그인에 실패했습니다. ${error.code || "Firebase Auth 설정을 확인하세요."}`;
      console.error(error);
    }
  });
  $("#logoutButton").addEventListener("click", async () => {
    if (authApi) await authApi.logout();
  });
  $("#transactionCancel").addEventListener("click", () => {
    resetEditForm($("#transactionForm"), $("#transactionSubmit"), $("#transactionCancel"), "추가");
  });
  $("#allocationCancel").addEventListener("click", () => {
    resetEditForm($("#allocationForm"), $("#allocationSubmit"), $("#allocationCancel"), "저장");
  });
  $("#depositCancel").addEventListener("click", () => {
    resetEditForm($("#depositForm"), $("#depositSubmit"), $("#depositCancel"), "추가");
  });
  $("#settlementCancel").addEventListener("click", () => {
    resetEditForm($("#settlementForm"), $("#settlementSubmit"), $("#settlementCancel"), "추가");
  });
  $("#loanRepaymentCancel").addEventListener("click", () => {
    resetEditForm($("#loanRepaymentForm"), $("#loanRepaymentSubmit"), $("#loanRepaymentCancel"), "추가");
  });

  $("#transactionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    if (data.id && !confirm("거래 내역 수정을 저장할까요?")) return;
    const transaction = {
      id: data.id || crypto.randomUUID(),
      date: data.date,
      type: data.type,
      category: data.category,
      payer: data.payer,
      memo: data.memo,
      amount: numberFromMoney(data.amount)
    };
    const index = state.transactions.findIndex((item) => item.id === transaction.id);
    if (index >= 0) state.transactions[index] = transaction;
    else state.transactions.push(transaction);
    resetEditForm(event.currentTarget, $("#transactionSubmit"), $("#transactionCancel"), "추가");
    await persist();
  });

  $("#allocationForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    if (data.id && !confirm("고정비 항목 수정을 저장할까요?")) return;
    const originalCategory = data.originalCategory;
    const allocation = {
      id: data.id || newId(),
      category: data.category,
      detail: data.detail?.trim() || "",
      owner: data.owner || "",
      bank: data.bank?.trim() || "",
      account: data.account?.trim() || "",
      transferDay: dayNumber(data.transferDay),
      amount: numberFromMoney(data.amount)
    };
    const index = state.allocations.findIndex((item) => item.id === allocation.id);
    if (index >= 0) {
      state.allocations[index] = allocation;
      state.distributions
        .filter((item) => item.allocationId === allocation.id || (!item.allocationId && item.category === originalCategory))
        .forEach((item) => {
          item.allocationId = allocation.id;
          item.category = allocation.category;
          const transaction = state.transactions.find((tx) => tx.id === item.transactionId);
          if (transaction) {
            transaction.category = allocation.category;
            transaction.memo = allocationDistributionMemo(allocation);
            transaction.amount = allocation.amount;
          }
        });
    } else {
      state.allocations.push(allocation);
    }
    resetEditForm(event.currentTarget, $("#allocationSubmit"), $("#allocationCancel"), "저장");
    await persist();
  });

  $("#depositForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    if (data.id && !confirm("예적금 기록 수정을 저장할까요?")) return;
    const deposit = {
      id: data.id || crypto.randomUUID(),
      name: data.name,
      owner: data.owner,
      kind: data.kind,
      startDate: data.startDate,
      maturityDate: data.maturityDate,
      rate: Number(data.rate),
      calculationType: "subscription",
      amount: numberFromMoney(data.amount)
    };
    deposit.currentAmount = depositSavedCurrentAmount(deposit);
    const index = state.deposits.findIndex((item) => item.id === deposit.id);
    if (index >= 0) state.deposits[index] = deposit;
    else state.deposits.push(deposit);
    resetEditForm(event.currentTarget, $("#depositSubmit"), $("#depositCancel"), "추가");
    await persist();
  });

  $("#housingForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!confirm("주택 자금 정보를 수정할까요?")) return;
    const data = formData(event.currentTarget);
    state.housing = {
      jeonse: moneyOrFallback(data.jeonse, state.housing.jeonse),
      ownFund: moneyOrFallback(data.ownFund, state.housing.ownFund),
      loan: moneyOrFallback(data.loan, state.housing.loan),
      interest: moneyOrFallback(data.interest, state.housing.interest)
    };
    await persist();
  });

  $("#settlementForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    if (data.id && !confirm("생활비 정산 기록 수정을 저장할까요?")) return;
    const settlement = {
      id: data.id || crypto.randomUUID(),
      date: data.date,
      type: "expense",
      category: "생활비",
      payer: data.payer,
      memo: data.memo,
      amount: numberFromMoney(data.amount)
    };
    const index = state.transactions.findIndex((item) => item.id === settlement.id);
    if (index >= 0) state.transactions[index] = settlement;
    else state.transactions.push(settlement);
    resetEditForm(event.currentTarget, $("#settlementSubmit"), $("#settlementCancel"), "추가");
    await persist();
  });

  $("#loanRepaymentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    if (data.id && !confirm("대출금 상환 기록 수정을 저장할까요?")) return;
    const repayment = {
      id: data.id || crypto.randomUUID(),
      date: data.date,
      amount: numberFromMoney(data.amount),
      memo: data.memo
    };
    const index = state.housingRepayments.findIndex((item) => item.id === repayment.id);
    if (index >= 0) state.housingRepayments[index] = repayment;
    else state.housingRepayments.push(repayment);
    resetEditForm(event.currentTarget, $("#loanRepaymentSubmit"), $("#loanRepaymentCancel"), "추가");
    await persist();
  });

  document.addEventListener("click", async (event) => {
    const transactionId = event.target.dataset.deleteTransaction;
    const depositId = event.target.dataset.deleteDeposit;
    const editTransactionId = event.target.dataset.editTransaction;
    const editSettlementId = event.target.dataset.editSettlement;
    const editDepositId = event.target.dataset.editDeposit;
    const editAllocationCategory = event.target.dataset.editAllocation;
    const deleteAllocationCategory = event.target.dataset.deleteAllocation;
    const updateCategoryIndex = event.target.dataset.updateCategoryIndex;
    const deleteCategoryIndex = event.target.dataset.deleteCategoryIndex;
    const editLoanRepaymentId = event.target.dataset.editLoanRepayment;
    const deleteLoanRepaymentId = event.target.dataset.deleteLoanRepayment;
    const openDistribution = event.target.dataset.openDistribution;
    const confirmDistribution = event.target.dataset.confirmDistribution;

    if (editTransactionId) {
      const transaction = state.transactions.find((item) => item.id === editTransactionId);
      if (!transaction) return;
      fillForm($("#transactionForm"), transaction);
      $("#transactionSubmit").textContent = "수정 저장";
      $("#transactionCancel").classList.remove("hidden");
      setView("transactions");
      return;
    }

    if (editSettlementId) {
      const settlement = state.transactions.find((item) => item.id === editSettlementId);
      if (!settlement) return;
      fillForm($("#settlementForm"), settlement);
      $("#settlementSubmit").textContent = "수정 저장";
      $("#settlementCancel").classList.remove("hidden");
      setView("settlements");
      return;
    }

    if (editDepositId) {
      const deposit = state.deposits.find((item) => item.id === editDepositId);
      if (!deposit) return;
      fillForm($("#depositForm"), deposit);
      $("#depositSubmit").textContent = "수정 저장";
      $("#depositCancel").classList.remove("hidden");
      setView("deposits");
      return;
    }

    if (editAllocationCategory) {
      const allocation = state.allocations.find((item) => item.id === editAllocationCategory || item.category === editAllocationCategory);
      if (!allocation) return;
      fillForm($("#allocationForm"), {
        id: allocation.id,
        originalCategory: allocation.category,
        category: allocation.category,
        detail: allocation.detail || "",
        owner: allocation.owner || "",
        bank: allocation.bank || "",
        account: allocation.account || "",
        transferDay: allocation.transferDay || "",
        amount: allocation.amount
      });
      $("#allocationSubmit").textContent = "수정 저장";
      $("#allocationCancel").classList.remove("hidden");
      setView("budgets");
      return;
    }

    if (editLoanRepaymentId) {
      const repayment = state.housingRepayments.find((item) => item.id === editLoanRepaymentId);
      if (!repayment) return;
      fillForm($("#loanRepaymentForm"), repayment);
      $("#loanRepaymentSubmit").textContent = "수정 저장";
      $("#loanRepaymentCancel").classList.remove("hidden");
      setView("housing");
      return;
    }

    if (deleteLoanRepaymentId) {
      const confirmed = confirm("이 대출금 상환 기록을 삭제할까요?");
      if (!confirmed) return;
      state.housingRepayments = state.housingRepayments.filter((item) => item.id !== deleteLoanRepaymentId);
      await persist();
      return;
    }

    if (updateCategoryIndex !== undefined) {
      const scope = $("#categoryScope").value;
      const categories = categoriesForScope(scope);
      const index = Number(updateCategoryIndex);
      const previous = categories[index];
      const input = document.querySelector(`[data-category-edit-input="${index}"]`);
      const next = input?.value.trim();
      if (!previous || !next || previous === next) return;
      if (categories.some((item, itemIndex) => itemIndex !== index && item === next)) {
        alert("이미 같은 이름의 항목이 있습니다.");
        return;
      }
      const confirmed = confirm(`${categoryScopeLabel(scope)} 항목 '${previous}'을 '${next}'로 수정할까요? 기존 관련 기록도 함께 변경됩니다.`);
      if (!confirmed) return;
      categories[index] = next;
      renameCategoryReferences(scope, previous, next);
      normalizeState();
      await persist();
      return;
    }

    if (deleteCategoryIndex !== undefined) {
      const scope = $("#categoryScope").value;
      const categories = categoriesForScope(scope);
      const index = Number(deleteCategoryIndex);
      const category = categories[index];
      if (!category) return;
      const confirmed = confirm(`${categoryScopeLabel(scope)} 항목 '${category}'을 선택 목록에서 제거할까요? 기존 기록은 유지됩니다.`);
      if (!confirmed) return;
      categories.splice(index, 1);
      await persist();
      return;
    }

    if (deleteAllocationCategory) {
      const allocation = state.allocations.find((item) => item.id === deleteAllocationCategory || item.category === deleteAllocationCategory);
      if (!allocation) return;
      const confirmed = confirm(`${allocationTitle(allocation)} 고정비 항목을 삭제할까요? 이미 생성된 거래 내역은 유지됩니다.`);
      if (!confirmed) return;
      state.allocations = state.allocations.filter((item) => item.id !== allocation.id);
      state.distributions = state.distributions.filter((item) =>
        item.allocationId !== allocation.id && !(item.category === allocation.category && !item.allocationId)
      );
      await persist();
      return;
    }

    if (openDistribution) {
      const panel = document.querySelector(`[data-date-panel="${openDistribution}"]`);
      if (panel) panel.classList.add("open");
      return;
    }

    if (confirmDistribution) {
      const input = document.querySelector(`[data-distribution-date="${confirmDistribution}"]`);
      completeDistribution(confirmDistribution, input?.value);
      await persist();
      return;
    }

    if (transactionId) {
      const confirmed = confirm("이 거래 내역을 삭제할까요?");
      if (!confirmed) return;
      state.transactions = state.transactions.filter((item) => item.id !== transactionId);
      state.distributions = state.distributions.filter((item) => item.transactionId !== transactionId);
      await persist();
    }
    if (depositId) {
      const confirmed = confirm("이 예적금 기록을 삭제할까요?");
      if (!confirmed) return;
      state.deposits = state.deposits.filter((item) => item.id !== depositId);
      await persist();
    }
  });
}

bindEvents();
await initSync();
render();
