import { allowedEmails, firebaseConfig } from "./firebase-config.js";

const householdId = "default-household";
const localKey = "couple-budget-state-v1";

const emptyState = {
  transactions: [],
  allocations: [],
  distributions: [],
  deposits: [],
  housingRepayments: [],
  housing: { jeonse: 0, ownFund: 0, loan: 0, interest: 0 }
};

let state = structuredClone(emptyState);
let saveState = () => localStorage.setItem(localKey, JSON.stringify(state));
let remoteReady = false;
let authApi = null;

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
const won = (value) => `${Math.round(value || 0).toLocaleString("ko-KR")}원`;
const monthOf = (date) => date.slice(0, 7);
const currentSystemMonth = () => new Date().toISOString().slice(0, 7);

function normalizeState() {
  state.transactions ||= [];
  state.allocations ||= [];
  state.distributions ||= [];
  state.deposits ||= [];
  state.housingRepayments ||= [];
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

    saveState = async () => dbMod.setDoc(docRef, state);

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
  return $("#monthSelect").value || "2026-05";
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

function sum(items, predicate) {
  return items.filter(predicate).reduce((total, item) => total + Number(item.amount || 0), 0);
}

function assetParts() {
  const tx = monthTransactions();
  const income = sum(tx, (item) => item.type === "income");
  const expense = sum(tx, (item) => item.type === "expense" && item.payer === "공용 통장");
  const sharedCash = income - expense;
  const deposits = state.deposits.reduce((total, item) => total + Number(item.amount || 0), 0);
  const housingNet = Math.max(0, Number(state.housing.jeonse || 0) - loanRemaining());
  return { sharedCash, deposits, housingNet, total: sharedCash + deposits + housingNet };
}

function totalLoanRepayment() {
  return state.housingRepayments.reduce((total, item) => total + Number(item.amount || 0), 0);
}

function loanRemaining() {
  return Math.max(0, Number(state.housing.loan || 0) - totalLoanRepayment());
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
  const months = [...new Set(state.transactions.map((item) => monthOf(item.date)))].sort().slice(-6);
  const rows = months.map((month) => {
    const tx = state.transactions.filter((item) => monthOf(item.date) === month);
    return {
      month,
      income: sum(tx, (item) => item.type === "income"),
      expense: sum(tx, (item) => item.type === "expense")
    };
  });
  const max = Math.max(1, ...rows.flatMap((row) => [row.income, row.expense]));
  $("#monthlyChart").innerHTML = rows.map((row) => `
    <div class="month-bars">
      <div class="bar-pair">
        <span class="bar income-bar" title="수입 ${won(row.income)}" style="height:${Math.max(4, row.income / max * 190)}px"></span>
        <span class="bar expense-bar" title="지출 ${won(row.expense)}" style="height:${Math.max(4, row.expense / max * 190)}px"></span>
      </div>
      <span>${Number(row.month.slice(5))}월</span>
    </div>
  `).join("");
}

function renderLists() {
  $("#allocationList").innerHTML = state.allocations.map((item) => `
    <div class="item"><div class="item-row"><strong>${item.category}</strong><span>${won(item.amount)}</span></div></div>
  `).join("");

  $("#budgetList").innerHTML = state.allocations.map((item) => {
    const done = state.distributions.find((entry) => entry.month === currentMonth() && entry.category === item.category);
    return `
      <div class="item ${done ? "completed" : ""}">
        <div class="item-row">
          <label class="check-row">
            <input type="checkbox" data-open-distribution="${item.category}" ${done ? "checked disabled" : ""}>
            <strong>${item.category}</strong>
          </label>
          <span>${won(item.amount)}</span>
        </div>
        <div class="item-actions">
          <button class="btn" data-edit-allocation="${item.category}">수정</button>
          <button class="delete-btn" data-delete-allocation="${item.category}">삭제</button>
        </div>
        ${done
          ? `<span class="status-pill">${done.date} 분배 완료</span>`
          : `<div class="distribution-actions" data-date-panel="${item.category}">
              <input type="date" data-distribution-date="${item.category}" value="${currentMonth()}-01">
              <button class="btn primary" data-confirm-distribution="${item.category}">확인</button>
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
      <td>${item.name}</td><td>${item.kind}</td><td>${item.startDate}</td><td>${item.maturityDate}</td><td>${item.rate}%</td>
      <td class="right">${won(item.amount)}</td>
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
  renderMonthSelect();
  renderMetrics();
  renderMonthlyChart();
  renderLists();
  renderTransactions();
  renderSettlement();
  renderDeposits();
  renderHousing();
  renderAssetChart();
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

function completeDistribution(category, date) {
  const allocation = state.allocations.find((item) => item.category === category);
  if (!allocation || !date) return;

  const alreadyDone = state.distributions.some((entry) => entry.month === currentMonth() && entry.category === category);
  if (alreadyDone) return;

  const transactionId = crypto.randomUUID();
  state.distributions.push({ month: currentMonth(), category, date, transactionId });
  state.transactions.push({
    id: transactionId,
    date,
    type: "expense",
    category,
    payer: "공용 통장",
    memo: `${category} 분배`,
    amount: Number(allocation.amount || 0)
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
  $("#resetButton").addEventListener("click", async () => {
    const confirmed = confirm("모든 가계부 데이터를 삭제하고 빈 상태로 초기화할까요?");
    if (!confirmed) return;
    state = structuredClone(emptyState);
    localStorage.removeItem(localKey);
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
      amount: Number(data.amount)
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
    if (data.originalCategory && !confirm("고정비 항목 수정을 저장할까요?")) return;
    const originalCategory = data.originalCategory;
    const amount = Number(data.amount);
    const existing = state.allocations.find((item) => item.category === (originalCategory || data.category));
    if (existing) {
      existing.category = data.category;
      existing.amount = amount;
      state.distributions
        .filter((item) => item.category === (originalCategory || data.category))
        .forEach((item) => {
          item.category = data.category;
          const transaction = state.transactions.find((tx) => tx.id === item.transactionId);
          if (transaction) {
            transaction.category = data.category;
            transaction.memo = `${data.category} 분배`;
            transaction.amount = amount;
          }
        });
    } else {
      state.allocations.push({ category: data.category, amount });
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
      kind: data.kind,
      startDate: data.startDate,
      maturityDate: data.maturityDate,
      rate: Number(data.rate),
      amount: Number(data.amount)
    };
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
      jeonse: Number(data.jeonse || state.housing.jeonse),
      ownFund: Number(data.ownFund || state.housing.ownFund),
      loan: Number(data.loan || state.housing.loan),
      interest: Number(data.interest || state.housing.interest)
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
      amount: Number(data.amount)
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
      amount: Number(data.amount),
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
      const allocation = state.allocations.find((item) => item.category === editAllocationCategory);
      if (!allocation) return;
      fillForm($("#allocationForm"), { originalCategory: allocation.category, category: allocation.category, amount: allocation.amount });
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

    if (deleteAllocationCategory) {
      const confirmed = confirm(`${deleteAllocationCategory} 고정비 항목을 삭제할까요? 이미 생성된 거래 내역은 유지됩니다.`);
      if (!confirmed) return;
      state.allocations = state.allocations.filter((item) => item.category !== deleteAllocationCategory);
      state.distributions = state.distributions.filter((item) => item.category !== deleteAllocationCategory);
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
