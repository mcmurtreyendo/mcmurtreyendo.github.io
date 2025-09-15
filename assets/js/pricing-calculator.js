// assets/js/pricing-calculator.js
(function () {
  // --- FEES: per-tooth objects for EVERY procedure (ready for editing) ---
  var FEES = {
    delta: {
      evaluation: { anterior: 78, bicuspid: 78, molar: 78 },
      rootCanal: { anterior: 676, bicuspid: 798, molar: 1007 },
      rootSurgery: { anterior: 974, bicuspid: 995, molar: 1500 },
      retx: { anterior: 837, bicuspid: 983, molar: 1340 },
      cbct: { anterior: 200, bicuspid: 200, molar: 200 }
    },
    uhc: {
      evaluation: { anterior: 94, bicuspid: 94, molar: 94 },
      rootCanal: { anterior: 682, bicuspid: 765, molar: 972 },
      rootSurgery: { anterior: 1062, bicuspid: 1154, molar: 1705 },
      retx: { anterior: 822, bicuspid: 927, molar: 1118 },
      cbct: { anterior: 132, bicuspid: 132, molar: 132 }
    },
    aetna: {
      evaluation: { anterior: 86, bicuspid: 86, molar: 86 },
      rootCanal: { anterior: 735, bicuspid: 834, molar: 1086 },
      rootSurgery: { anterior: 1112, bicuspid: 1178, molar: 1723 },
      retx: { anterior: 851, bicuspid: 991, molar: 1218 },
      cbct: { anterior: 200, bicuspid: 200, molar: 200 }
    },
    careington: {
      evaluation: { anterior: 163.8, bicuspid: 163.8, molar: 163.8 },
      rootCanal: { anterior: 1242, bicuspid: 1378.8, molar: 1562.4 },
      rootSurgery: { anterior: 1846.5, bicuspid: 1999.5, molar: 3208.2 },
      retx: { anterior: 1485.9, bicuspid: 1551.6, molar: 1983.6 },
      cbct: { anterior: 200, bicuspid: 200, molar: 200 }
    },
    anthem: {
      evaluation: { anterior: 92, bicuspid: 92, molar: 92 },
      rootCanal: { anterior: 747, bicuspid: 808, molar: 977 },
      rootSurgery: { anterior: 1115, bicuspid: 1165, molar: 1730 },
      retx: { anterior: 960, bicuspid: 1010, molar: 1162 },
      cbct: { anterior: 200, bicuspid: 200, molar: 200 }
    },
    metlife: {
      evaluation: { anterior: 68, bicuspid: 68, molar: 68 },
      rootCanal: { anterior: 563, bicuspid: 673, molar: 910 },
      rootSurgery: { anterior: 811, bicuspid: 878, molar: 1384 },
      retx: { anterior: 705, bicuspid: 810, molar: 1040 },
      cbct: { anterior: 200, bicuspid: 200, molar: 200 }
    },
    unitedconcordia: {
      evaluation: { anterior: 65.21, bicuspid: 65.21, molar: 65.21 },
      rootCanal: { anterior: 627.87, bicuspid: 732.05, molar: 988.39 },
      rootSurgery: { anterior: 748.16, bicuspid: 822.1, molar: 1257.34 },
      retx: { anterior: 678.57, bicuspid: 778.35, molar: 1111.25 },
      cbct: { anterior: 200, bicuspid: 200, molar: 200 }
    }
  };

  // Self-pay / cash schedule — per-tooth for every procedure too
  var CASH = {
    evaluation: { anterior: 122, bicuspid: 122, molar: 122 },
    rootCanal: { anterior: 1080, bicuspid: 1250, molar: 1425 },
    rootSurgery: { anterior: 1120, bicuspid: 1120, molar: 1120 },
    retx: { anterior: 900, bicuspid: 900, molar: 900 },
    cbct: { anterior: 200, bicuspid: 200, molar: 200 }
  };

  // Coverage defaults
  var COVERAGE_DEFAULTS = {
    delta: { endo: 0.8, diag: 1.0, cbct: 0.0 },
    uhc: { endo: 0.8, diag: 0.8, cbct: 0.0 },
    guardian: { endo: 0.8, diag: 0.8, cbct: 0.0 },
    aetna: { endo: 0.8, diag: 0.8, cbct: 0.0 },
    anthem: { endo: 0.8, diag: 0.8, cbct: 0.0 },
    cigna: { endo: 0.8, diag: 0.8, cbct: 0.0 },
    noins: { endo: 0.0, diag: 0.0, cbct: 0.0 }
  };

  // --- helpers (unchanged) ---
  function $(sel, root) { return (root || document).querySelector(sel); }
  function root() { return document.getElementById('insurance-calculator'); }
  function fmt(n) { return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' }); }
  function clamp(n, a, b) { return Math.min(Math.max(n, a), b); }
  function readPct(el) {
    var raw = parseFloat(el.value);
    if (isNaN(raw)) return NaN;
    var val = raw > 1 ? raw / 100 : raw;
    return clamp(val, 0, 1);
  }
  function getInsurer(r) { var c = $('input[name="insurer"]:checked', r); return c ? String(c.value).toLowerCase() : ''; }
  function getProcedure(r) { var c = $('input[name="procedure"]:checked', r); return c ? String(c.value) : ''; }

  // Map ADA tooth numbers (1–32) into categories
  function mapToothCategory(num) {
    var n = parseInt(num, 10);
    if (isNaN(n) || n < 1 || n > 32) return 'anterior';
    if ((n >= 6 && n <= 11) || (n >= 22 && n <= 27)) return 'anterior';
    if ((n >= 4 && n <= 5) || (n >= 12 && n <= 13) || (n >= 20 && n <= 21) || (n >= 28 && n <= 29)) return 'bicuspid';
    return 'molar';
  }

  // Resolve a fee given table + procedure + tooth category
  function feeFor(table, proc, toothCat) {
    var v = table[proc];
    if (v == null) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'object') {
      if (v[toothCat] != null) return v[toothCat];
      return v.anterior ?? v.bicuspid ?? v.molar ?? null;
    }
    return null;
  }

  function prefillCoverage(r) {
    var d = COVERAGE_DEFAULTS[getInsurer(r)];
    var endo = $('#endoCov', r), diag = $('#diagCov', r);
    if (!d || !endo || !diag) return;
    if (!endo.value) endo.value = (d.endo * 100).toFixed(0);
    if (!diag.value) diag.value = (d.diag * 100).toFixed(0);
  }

  function reveal(out) {
    if (!out) return;
    out.hidden = false;
    out.removeAttribute('hidden');
    out.style.display = 'block';
  }

  function estimateLineItem(fee, covPct, maxRemain, dedRemain, deductibleApplies) {
    var applied = 0;
    if (deductibleApplies && covPct > 0) {
      applied = Math.min(Math.max(0, dedRemain), fee);
    }
    var eligible = Math.max(0, fee - applied);
    var insBeforeMax = eligible * covPct;
    var insPays = Math.min(insBeforeMax, Math.max(0, maxRemain));
    var patient = Math.max(0, fee - insPays);
    var maxLeft = Math.max(0, maxRemain - insPays);
    var dedLeft = Math.max(0, dedRemain - applied);
    return { patient: patient, insurance: insPays, appliedDeductible: applied, maxLeft: maxLeft, dedLeft: dedLeft };
  }

  function calculate(r) {
    var endo = $('#endoCov', r), diag = $('#diagCov', r), max = $('#maxRemain', r), ded = $('#deductRemain', r);
    var box = $('#calc2-result', r),
        p = $('#calc2-patient', r), fee = $('#calc2-fee', r),
        dd = $('#calc2-deduct', r), cov = $('#calc2-cov', r), ins = $('#calc2-ins', r), left = $('#calc2-maxleft', r);

    var outCbct = $('#calc2-cbct', r),
        outEval = $('#calc2-evalcopay', r),
        outTotalTreat = $('#calc2-total-treatment', r),
        outTotalAll = $('#calc2-total-all', r);

    if (!endo || !diag || !max || !ded || !box) return;

    var insr = getInsurer(r), proc = getProcedure(r);
    if (!insr || !proc) return;

    var toothInput = $('#toothNum', r);
    var toothCat = mapToothCategory(toothInput ? toothInput.value : null);

    if (insr !== 'noins') {
      var need = [endo, diag, max, ded];
      for (var i = 0; i < need.length; i++) { if (!need[i].reportValidity()) return; }
    } else {
      if (!endo.value) endo.value = '0';
      if (!diag.value) diag.value = '0';
      if (!max.value) max.value = '0';
      if (!ded.value) ded.value = '0';
    }

    var fees = (insr === 'noins') ? CASH : (FEES[insr] || {});
    var base = feeFor(fees, proc, toothCat);
    if (base == null) base = feeFor(CASH, proc, toothCat);
    var cbctFee = feeFor(fees, 'cbct', toothCat); if (cbctFee == null) cbctFee = feeFor(CASH, 'cbct', toothCat);
    var evalFee = feeFor(fees, 'evaluation', toothCat); if (evalFee == null) evalFee = feeFor(CASH, 'evaluation', toothCat);

    var endoPct = (insr === 'noins') ? 0 : readPct(endo);
    var diagPct = (insr === 'noins') ? 0 : readPct(diag);
    if (isNaN(endoPct) || isNaN(diagPct)) { alert('Enter valid coverage percentages.'); return; }
    var cbctPct = (insr === 'noins') ? 0 : (COVERAGE_DEFAULTS[insr] ? COVERAGE_DEFAULTS[insr].cbct : 0.0);

    var maxStart = (insr === 'noins') ? 0 : Math.max(0, parseFloat(max.value || '0'));
    var dedStart = (insr === 'noins') ? 0 : Math.max(0, parseFloat(ded.value || '0'));

    if (proc === 'evaluation') {
      var evalRes = estimateLineItem(evalFee, diagPct, maxStart, dedStart, false);
      var cbctRes = estimateLineItem(cbctFee, cbctPct, evalRes.maxLeft, evalRes.dedLeft, false);

      var treatTotalRow = outTotalTreat ? outTotalTreat.parentElement : null;
      var allTotalRow = outTotalAll ? outTotalAll.parentElement : null;

      if (fee) fee.textContent = fmt(evalFee);
      if (dd) dd.textContent = fmt(0);
      if (cov) cov.textContent = (diagPct * 100).toFixed(0) + '%';
      if (ins) ins.textContent = fmt(evalRes.insurance + cbctRes.insurance);
      if (left) left.textContent = fmt(cbctRes.maxLeft);
      if (p) p.textContent = fmt(evalRes.patient + cbctRes.patient);

      if (outCbct) outCbct.textContent = fmt(cbctRes.patient);
      if (outEval) outEval.textContent = fmt(evalRes.patient);
      if (outTotalTreat) outTotalTreat.textContent = fmt(0);
      if (outTotalAll) outTotalAll.textContent = fmt(evalRes.patient + cbctRes.patient);

      if (treatTotalRow) treatTotalRow.style.display = 'none';
      if (allTotalRow) {
        var n = allTotalRow.firstChild;
        if (n && n.nodeType === 3) { n.nodeValue = 'Evaluation total (incl. CBCT): '; }
      }

      reveal(box);
      return;
    }

    // Treatment visit (Treatment + CBCT + Evaluation)
    var maxRemain = maxStart, dedRemain = dedStart;

    var procRes = estimateLineItem(base, endoPct, maxRemain, dedRemain, true);
    maxRemain = procRes.maxLeft; dedRemain = procRes.dedLeft;

    var cbctRes2 = estimateLineItem(cbctFee, cbctPct, maxRemain, dedRemain, false);
    maxRemain = cbctRes2.maxLeft;

    var evalRes2 = estimateLineItem(evalFee, diagPct, maxStart, dedStart, false);

    var treatmentPatient = procRes.patient + cbctRes2.patient;
    var treatmentPlusEval = treatmentPatient + evalRes2.patient;

    if (fee) fee.textContent = fmt(base);
    if (dd) dd.textContent = fmt(procRes.appliedDeductible);
    if (cov) cov.textContent = (endoPct * 100).toFixed(0) + '%';
    if (ins) ins.textContent = fmt(procRes.insurance);
    if (left) left.textContent = fmt(maxRemain);
    if (outCbct) outCbct.textContent = fmt(cbctRes2.patient);
    if (outEval) outEval.textContent = fmt(evalRes2.patient);

    if (p) p.textContent = fmt(treatmentPatient);

    var treatTotalRow = outTotalTreat ? outTotalTreat.parentElement : null;
    var allTotalRow = outTotalAll ? outTotalAll.parentElement : null;

    if (treatTotalRow) treatTotalRow.style.display = '';
    if (outTotalTreat) outTotalTreat.textContent = fmt(procRes.patient);
    if (treatTotalRow && treatTotalRow.firstChild && treatTotalRow.firstChild.nodeType === 3) {
      treatTotalRow.firstChild.nodeValue = 'Procedure only (no CBCT/Eval): ';
    }

    if (outTotalAll) outTotalAll.textContent = fmt(treatmentPlusEval);
    if (allTotalRow && allTotalRow.firstChild && allTotalRow.firstChild.nodeType === 3) {
      allTotalRow.firstChild.nodeValue = 'Total for today’s visit: ';
    }

    reveal(box);
  }

  function resetCalc(r) {
    var endo = $('#endoCov', r), diag = $('#diagCov', r), max = $('#maxRemain', r), ded = $('#deductRemain', r), box = $('#calc2-result', r);
    if (endo) endo.value = ''; if (diag) diag.value = ''; if (max) max.value = ''; if (ded) ded.value = '';
    if (box) { box.hidden = true; box.style.display = 'none'; }
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t) return;

    if (t.id === 'calc2-btn') {
      e.preventDefault();
      calculate(root());
    }
    else if (t.id === 'calc2-reset') {
      e.preventDefault();
      resetCalc(root());
    }
    else if (t.id === 'calc2-print') {
      e.preventDefault();
      window.print();
    }
  });

  document.addEventListener('change', function (e) {
    var t = e.target; if (!t || t.name !== 'insurer') return;
    var r = root(); if (!r) return;
    var val = String(t.value).toLowerCase();

    var endo = $('#endoCov', r), diag = $('#diagCov', r), max = $('#maxRemain', r), ded = $('#deductRemain', r);
    if (!endo || !diag || !max || !ded) return;

    if (val === 'noins') {
      endo.value = '0'; diag.value = '0'; max.value = '0'; ded.value = '0';
    } else {
      if (!endo.value) endo.value = '';
      if (!diag.value) diag.value = '';
      prefillCoverage(r);
    }
  });

  if (document.readyState !== 'loading') { var r0 = root(); if (r0) prefillCoverage(r0); }
  else document.addEventListener('DOMContentLoaded', function () { var r0 = root(); if (r0) prefillCoverage(r0); }, { once: true });
})();
