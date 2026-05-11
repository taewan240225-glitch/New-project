(() => {
  const moneyFieldNames = new Set(["amount", "jeonse", "ownFund", "loan", "interest"]);
  const moneySelector = [...moneyFieldNames]
    .map((name) => `input[name="${name}"]:not([type="hidden"])`)
    .join(",");

  const digitsOnly = (value) => String(value ?? "").replace(/[^0-9]/g, "");
  const formatCommaInput = (value) => {
    const digits = digitsOnly(value);
    if (!digits) return "";
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };

  function placeCaretAtEnd(input) {
    if (document.activeElement !== input) return;
    const position = input.value.length;
    try {
      input.setSelectionRange(position, position);
    } catch {
      // Some browsers can reject selection changes while input is not focusable.
    }
  }

  function formatMoneyInput(input) {
    input.value = formatCommaInput(input.value);
    placeCaretAtEnd(input);
  }

  function toRawNumber(input) {
    input.value = digitsOnly(input.value);
  }

  function moneyInputs(scope = document) {
    return [...scope.querySelectorAll(moneySelector)];
  }

  function prepareMoneyInput(input) {
    if (input.dataset.moneyInput === "true") return;

    input.dataset.moneyInput = "true";
    input.type = "text";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.removeAttribute("min");
    input.removeAttribute("max");
    input.removeAttribute("step");
    input.style.textAlign = "right";
    input.style.fontVariantNumeric = "tabular-nums";

    input.addEventListener("focus", () => placeCaretAtEnd(input));
    input.addEventListener("input", () => formatMoneyInput(input));
    input.addEventListener("blur", () => formatMoneyInput(input));
    input.addEventListener("change", () => formatMoneyInput(input));

    formatMoneyInput(input);
  }

  function prepareMoneyInputs(scope = document) {
    moneyInputs(scope).forEach(prepareMoneyInput);
  }

  document.addEventListener(
    "submit",
    (event) => {
      if (!(event.target instanceof HTMLFormElement)) return;
      const inputs = moneyInputs(event.target);
      inputs.forEach(toRawNumber);
      requestAnimationFrame(() => inputs.forEach(formatMoneyInput));
    },
    true
  );

  document.addEventListener(
    "reset",
    (event) => {
      if (!(event.target instanceof HTMLFormElement)) return;
      requestAnimationFrame(() => prepareMoneyInputs(event.target));
    },
    true
  );

  document.addEventListener("click", () => {
    setTimeout(() => prepareMoneyInputs(), 0);
  });

  if (document.body) {
    new MutationObserver(() => prepareMoneyInputs()).observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => prepareMoneyInputs());
  } else {
    prepareMoneyInputs();
  }
})();
