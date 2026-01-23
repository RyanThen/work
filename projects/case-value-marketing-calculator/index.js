(function () {
  // -----------------------------
  // CONFIG (easy to edit)
  // Uplifts are multiplicative factors:
  //   leads: 2.25 = +125%
  //   close: 1.30 = +30%
  // -----------------------------
  const CONFIG = {
    weeksPerYear: 52,

    uplift: {
      channel1: {
        // Service Tier #1 increases lead volume 50%
        ads: { leads: 1.5 },
        // Service Tier #2 increases lead volume 50%, close rate 50%
        sales: { leads: 1.5, close: 1.5 },
        // Service Tier #3 increases lead volume 75%, close rate 75%
        auto: { leads: 1.75, close: 1.75 }
      },
      channel2: {
        // Service Tier #1 increases lead volume 50%
        ads: { leads: 1.5 },
        // Service Tier #2 increases lead volume 75%, close rate 15%
        sales: { leads: 1.75, close: 1.15 },
        // Service Tier #3 increases lead volume 90%, close rate 30%
        auto: { leads: 1.9, close: 1.3 }
      },
      channel3: {
        // Service Tier #1 increases lead volume 25%
        ads: { leads: 1.25 },
        // Service Tier #2 increases lead volume 50%
        sales: { leads: 1.5 },
        // Service Tier #3 increases lead volume 75%, close rate 50%
        auto: { leads: 1.75, close: 1.5 }
      }
    },

    // Display & calculation rounding
    // IMPORTANT: Revenue will be computed from the ROUNDED client count.
    decimalsClients: 1,  // set to 2 for hundredths, etc.
    decimalsLeads: 1,
    decimalsClose: 1
  };

  // -----------------------------
  // Helpers
  // -----------------------------
  const nfCurrency0 = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  });

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function num(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  function roundTo(n, d) {
    const p = Math.pow(10, d);
    return Math.round(n * p) / p;
  }

  function formatClientsFromRounded(nRounded) {
    // nRounded is already rounded to CONFIG.decimalsClients
    const d = CONFIG.decimalsClients;
    if (d === 0) return `${Math.round(nRounded)} clients`;
    // if it’s effectively an int, show as int
    if (Math.abs(nRounded - Math.round(nRounded)) < 1e-9) {
      return `${Math.round(nRounded)} clients`;
    }
    return `${nRounded.toFixed(d)} clients`;
  }

  function formatCurrency(n) {
    return nfCurrency0.format(Math.round(n));
  }

  function setInputValueClean(input, value, decimals) {
    if (!input) return;
    const v = roundTo(value, decimals);
    let s = v.toFixed(decimals);
    if (decimals > 0) s = s.replace(/\.0+$/, ""); // 10.0 -> 10
    input.value = s;
  }

  // Given a channel tile, compute multipliers based on checked boxes
  function getMultipliers(tile) {
    const channelKey = tile.getAttribute("data-channel");
    const channelUplifts = CONFIG.uplift[channelKey] || {};

    let leadsMul = 1;
    let closeMul = 1;
    let anyChecked = false;

    Object.keys(channelUplifts).forEach((toggleKey) => {
      const cb = tile.querySelector(`.toggle-${toggleKey}`);
      if (cb && cb.checked) {
        anyChecked = true;
        const u = channelUplifts[toggleKey] || {};
        if (typeof u.leads === "number") leadsMul *= u.leads;
        if (typeof u.close === "number") closeMul *= u.close;
      }
    });

    return { leadsMul, closeMul, anyChecked };
  }

  // -----------------------------
  // Main init
  // -----------------------------
  function init() {
    const root = document.querySelector(".roi-calc");
    if (!root) return;

    // ----- Case Value Wizard -----
    const hrsService1El = root.querySelector("#hrsService1");
    const hrsService2El = root.querySelector("#hrsService2");
    const billableRate1El = root.querySelector("#billableRate1");
    const billableRate2El = root.querySelector("#billableRate2");
    const cancelRateEl = root.querySelector("#cancelRate");

    const weeksServiceEl = root.querySelector("#weeksService");
    const caseRevenueEl = root.querySelector("#caseRevenue");

    let revenuePerClient = 0;

    function recalcCaseValue() {
      const hrsService1 = num(hrsService1El.value);
      const hrsService2 = num(hrsService2El.value);
      const billableRate1 = num(billableRate1El.value);
      const billableRate2 = num(billableRate2El.value);

      let cancelRate = num(cancelRateEl.value);
      cancelRate = clamp(cancelRate, 0, 100);
      cancelRateEl.value = cancelRate;

      const utilization = 1 - cancelRate / 100;

      const weeklyRevenue = hrsService1 * billableRate2 + hrsService2 * billableRate1;
      const weeksOfService = CONFIG.weeksPerYear * utilization;
      revenuePerClient = weeklyRevenue * CONFIG.weeksPerYear * utilization;

      if (weeksServiceEl) weeksServiceEl.textContent = weeksOfService.toFixed(1);
      if (caseRevenueEl) caseRevenueEl.textContent = formatCurrency(revenuePerClient);

      recalcAllChannels();
    }

    [hrsService1El, hrsService2El, billableRate1El, billableRate2El, cancelRateEl].forEach((el) => {
      if (!el) return;
      el.addEventListener("input", recalcCaseValue, { passive: true });
      el.addEventListener("change", recalcCaseValue, { passive: true });
    });

    // ----- Marketing ROI section -----
    const tiles = Array.from(root.querySelectorAll(".channel-tile"));

    // Base (Without Us) stored separately:
    // - tile.dataset.baseLeads/baseClose => Without Us baseline
    // - inputs show With Us (base * multipliers)
    // User edits inputs => we back-calc base by dividing by multipliers.
    function ensureBaseStored(tile) {
      if (tile.dataset.baseInit === "1") return;

      const leadsInput = tile.querySelector(".leads");
      const closeInput = tile.querySelector(".closeRate");
      if (!leadsInput || !closeInput) return;

      tile.dataset.baseLeads = String(num(leadsInput.value));
      tile.dataset.baseClose = String(num(closeInput.value));
      tile.dataset.baseInit = "1";
    }

    function setWithUsVisibility(tile, isVisible) {
      const withUsLine = tile.querySelector(".comparison p:nth-of-type(2)");
      if (!withUsLine) return;
      withUsLine.style.display = isVisible ? "" : "none";
    }

    function computeClients(leads, closePct) {
      // closePct is a percent in the UI
      const c = clamp(closePct, 0, 100);
      if (c <= 0) return 0;
      return leads * (c / 100);
    }

    function computeAndRender(tile, opts) {
      ensureBaseStored(tile);

      const leadsInput = tile.querySelector(".leads");
      const closeInput = tile.querySelector(".closeRate");

      const withoutClientsEl = tile.querySelector(".comparison .without.clients");
      const withClientsEl = tile.querySelector(".comparison .with.clients");
      const withoutRevenueEl = tile.querySelector(".comparison .without.revenue");
      const withRevenueEl = tile.querySelector(".comparison .with.revenue");

      if (!leadsInput || !closeInput) return;

      const { leadsMul, closeMul, anyChecked } = getMultipliers(tile);

      // Hide "With Us" line entirely when no boxes checked
      setWithUsVisibility(tile, anyChecked);

      // Baseline (Without Us)
      const baseLeads = num(tile.dataset.baseLeads);
      const baseClose = clamp(num(tile.dataset.baseClose), 0, 100);

      // With Us (uplifted, shown in inputs)
      const withLeads = baseLeads * leadsMul;
      const withClose = clamp(baseClose * closeMul, 0, 100);

      // Only force-set input values when requested (toggles change, blur/change)
      if (opts && opts.forceSetInputs) {
        setInputValueClean(leadsInput, withLeads, CONFIG.decimalsLeads);
        setInputValueClean(closeInput, withClose, CONFIG.decimalsClose);
      }

      // Clients (raw)
      const withoutClientsRaw = computeClients(baseLeads, baseClose);
      const withClientsRaw = computeClients(withLeads, withClose);

      // Rounded clients
      const withoutClientsRounded = roundTo(withoutClientsRaw, CONFIG.decimalsClients);
      const withClientsRounded = roundTo(withClientsRaw, CONFIG.decimalsClients);

      // Revenue computed FROM ROUNDED CLIENTS
      const withoutRevenue = withoutClientsRounded * revenuePerClient;
      const withRevenue = withClientsRounded * revenuePerClient;

      // Render Without Us always
      if (withoutClientsEl) {
        withoutClientsEl.textContent = formatClientsFromRounded(withoutClientsRounded);
      }
      if (withoutRevenueEl) {
        withoutRevenueEl.textContent = formatCurrency(withoutRevenue);
      }

      // Render With Us only if visible (boxes checked)
      if (anyChecked) {
        if (withClientsEl) {
          withClientsEl.textContent = formatClientsFromRounded(withClientsRounded);
        }
        if (withRevenueEl) {
          withRevenueEl.textContent = formatCurrency(withRevenue);
        }
      }
    }

    function recalcAllChannels() {
      tiles.forEach((t) => computeAndRender(t, { forceSetInputs: true }));
    }

    // Sync base from visible inputs:
    // base = visible / multipliers
    function syncBaseFromVisible(tile) {
      const leadsInput = tile.querySelector(".leads");
      const closeInput = tile.querySelector(".closeRate");
      if (!leadsInput || !closeInput) return;

      const visibleLeads = num(leadsInput.value);
      const visibleClose = num(closeInput.value);

      const { leadsMul, closeMul } = getMultipliers(tile);

      const baseLeads = leadsMul > 0 ? visibleLeads / leadsMul : 0;
      const baseClose = closeMul > 0 ? visibleClose / closeMul : 0;

      tile.dataset.baseLeads = String(baseLeads);
      tile.dataset.baseClose = String(clamp(baseClose, 0, 100));
    }

    tiles.forEach((tile) => {
      ensureBaseStored(tile);

      const leadsInput = tile.querySelector(".leads");
      const closeInput = tile.querySelector(".closeRate");

      const onTyping = () => {
        syncBaseFromVisible(tile);
        // Don't overwrite while typing
        computeAndRender(tile, { forceSetInputs: false });
      };

      const onCommit = () => {
        syncBaseFromVisible(tile);
        // Normalize displayed (with-us) values
        computeAndRender(tile, { forceSetInputs: true });
      };

      if (leadsInput) {
        leadsInput.addEventListener("input", onTyping, { passive: true });
        leadsInput.addEventListener("change", onCommit, { passive: true });
        leadsInput.addEventListener("blur", onCommit, { passive: true });
      }

      if (closeInput) {
        closeInput.addEventListener("input", onTyping, { passive: true });
        closeInput.addEventListener("change", onCommit, { passive: true });
        closeInput.addEventListener("blur", onCommit, { passive: true });
      }

      // Toggle changes: immediately update inputs + outputs
      tile.querySelectorAll(".toggles input[type='checkbox']").forEach((cb) => {
        cb.addEventListener(
          "change",
          () => {
            // Base stays constant; visible inputs reflect new multipliers
            computeAndRender(tile, { forceSetInputs: true });
          },
          { passive: true }
        );
      });
    });

    // Initial calc
    recalcCaseValue();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();