(function () {
    "use strict";

    var GAS_URL = "https://script.google.com/macros/s/AKfycbyEjJvFoBgHz8LMUt7dBauwHgIOByKnRR3N4ExpCXn3dk9zpkuQUogzC3f6Z7oAUtaxWQ/exec";
    var CONFIRMATION_PAGE = "referral-submitted.html";
    var STORAGE_FIELDS = "mcmReferralFields";
    var STORAGE_PRINT_HTML = "mcmReferralPrintHtml";

    var form = document.getElementById("refForm");
    var reviewPane = document.getElementById("reviewPane");
    var submitBtn = document.getElementById("submitBtn");
    var downloadBtn = document.getElementById("downloadReferralBtn");
    var updatingReview = false;

    if (!form) return;

    function requiredFieldsAreFilled() {
        return ["firstName", "lastName", "dob", "phone", "refDoc"].every(function (id) {
            var input = document.getElementById(id);
            return input && String(input.value || "").trim();
        });
    }

    function formValue(name) {
        var input = form.elements[name];
        return input ? String(input.value || "").trim() : "";
    }

    function isChecked(id) {
        var input = document.getElementById(id);
        if (!input) return false;
        if (input.type === "hidden") return input.value === "true";
        return !!input.checked;
    }

    function selectedReasons() {
        return Array.prototype.slice.call(document.querySelectorAll("#reasonChips .chip.active")).map(function (chip) {
            return chip.getAttribute("data-val") || chip.textContent.trim();
        });
    }

    function selectedTeeth() {
        return Array.prototype.slice.call(document.querySelectorAll(".tooth .pick.active")).map(function (button) {
            var tooth = button.closest(".tooth");
            var label = tooth ? tooth.querySelector(".n") : null;
            return label ? label.textContent.trim() : "";
        }).filter(Boolean);
    }

    function payloadFields() {
        return {
            firstName: formValue("firstName"),
            lastName: formValue("lastName"),
            dob: formValue("dob"),
            phone: formValue("phone"),
            email: formValue("email"),
            sex: formValue("sex"),
            refDoc: formValue("refDoc"),
            refPractice: formValue("refPractice"),
            refPhone: formValue("refPhone"),
            refEmail: formValue("refEmail"),
            refNotes: formValue("refNotes"),
            insCompany: formValue("insCompany"),
            groupNum: formValue("groupNum"),
            memberId: formValue("memberId"),
            planMax: formValue("planMax"),
            maxLeft: formValue("maxLeft"),
            deductible: formValue("deductible"),
            dedLeft: formValue("dedLeft"),
            insPhone: formValue("insPhone"),
            subscriber: formValue("subscriber"),
            urgency: formValue("urgency"),
            symptoms: formValue("symptoms"),
            hx: formValue("hx"),
            meds: formValue("meds"),
            okXrays: isChecked("okXrays") ? "true" : "false",
            noInsurance: isChecked("noIns") ? "true" : "false",
            xrayDeliveryNote: formValue("xrayDeliveryNote"),
            reasons: JSON.stringify(selectedReasons()),
            teeth: JSON.stringify(selectedTeeth())
        };
    }

    function safeJsonArray(value) {
        try {
            var parsed = JSON.parse(value || "[]");
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    function escapeHtml(value) {
        return String(value || "").replace(/[&<>"']/g, function (char) {
            return {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                "\"": "&quot;",
                "'": "&#39;"
            }[char];
        });
    }

    function prettyDate(value) {
        if (!value) return "";
        var parts = String(value).split("-");
        var date = parts.length === 3
            ? new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
            : new Date(value);
        if (isNaN(date.getTime())) return value;
        return date.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric"
        });
    }

    function formattedName(fields) {
        return [fields.firstName, fields.lastName].filter(Boolean).join(" ").trim() || "Patient";
    }

    function filenameFor(fields) {
        var parts = ["Referral", fields.lastName || "Patient", fields.firstName || ""].filter(Boolean);
        return parts.join("-").replace(/[^a-z0-9-]+/gi, "-").replace(/-+/g, "-");
    }

    function kv(label, value) {
        var cleanValue = String(value || "").trim();
        if (!cleanValue) return "";
        return "<div class=\"kv\"><div>" + escapeHtml(label) + "</div><div>" + escapeHtml(cleanValue) + "</div></div>";
    }

    function toothCell(selected, number) {
        var isSelected = selected.indexOf(String(number)) > -1 || selected.indexOf(number) > -1;
        return "<div class=\"tooth-cell" + (isSelected ? " selected" : "") + "\"><span>" + number + "</span><b>" + (isSelected ? "X" : "") + "</b></div>";
    }

    function prettyDateWithAge(value) {
        if (!value) return "";
        var parts = String(value).split("-");
        var date = parts.length === 3
            ? new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
            : new Date(value);
        if (isNaN(date.getTime())) return value;

        var today = new Date();
        var age = today.getFullYear() - date.getFullYear();
        var monthDelta = today.getMonth() - date.getMonth();
        if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < date.getDate())) age -= 1;

        return date.toLocaleDateString() + " (" + age + " yrs)";
    }

    function correctReviewDob() {
        if (!reviewPane) return;
        var dob = formValue("dob");
        if (!dob) return;

        Array.prototype.slice.call(reviewPane.querySelectorAll(".kv")).forEach(function (row) {
            var cells = row.children;
            if (cells.length < 2) return;
            if (String(cells[0].textContent || "").trim() === "DOB") {
                cells[1].textContent = prettyDateWithAge(dob);
            }
        });
    }

    function slipField(label, value) {
        return "<div class=\"slip-field\"><span>" + escapeHtml(label) + "</span><strong>" + escapeHtml(value || "") + "</strong></div>";
    }

    function slipCheck(label, checked) {
        return "<span class=\"slip-check\"><span class=\"check-box\">" + (checked ? "X" : "") + "</span>" + escapeHtml(label) + "</span>";
    }

    function slipTextBlock(label, value) {
        var text = escapeHtml(value || "").replace(/\n/g, "<br>");
        return "<div class=\"text-block\"><div class=\"block-label\">" + escapeHtml(label) + "</div><div class=\"block-lines\">" + (text || "&nbsp;") + "</div></div>";
    }

    function reasonIsSelected(reasons, label) {
        return reasons.indexOf(label) > -1;
    }

    function buildPrintableHTML(fields) {
        var reasons = safeJsonArray(fields.reasons);
        var teeth = safeJsonArray(fields.teeth);
        var topTeeth = "";
        var bottomTeeth = "";
        var i;

        for (i = 1; i <= 16; i += 1) topTeeth += toothCell(teeth, i);
        for (i = 32; i >= 17; i -= 1) bottomTeeth += toothCell(teeth, i);

        return "<!doctype html><html><head><meta charset=\"utf-8\">" +
            "<title></title>" +
            "<style>" +
            "@page{size:Letter;margin:8mm}" +
            "*{box-sizing:border-box}" +
            "body{margin:0;background:#fff;color:#173244;font:10.5px/1.25 Arial,Helvetica,sans-serif}" +
            ".sheet{max-width:760px;margin:0 auto;padding:10px}" +
            ".slip{border:1.5px solid #6fa9bd;padding:12px 14px 10px;background:#fff}" +
            ".top{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:end;border-bottom:2px solid #6fa9bd;padding-bottom:8px}" +
            ".practice{font-size:22px;font-weight:800;letter-spacing:.02em;text-transform:uppercase;color:#0e5670}" +
            ".subtitle{font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin-top:2px;color:#426b7d}" +
            ".date-box{min-width:175px}" +
            ".section-title{background:#d9edf5;color:#0e5670;border:1px solid #82b7c9;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:4px 7px;margin:9px 0 6px;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
            ".grid{display:grid;gap:7px}" +
            ".cols-2{grid-template-columns:1fr 1fr}.cols-3{grid-template-columns:1fr 1fr 1fr}.cols-4{grid-template-columns:1fr 1fr 1fr 1fr}" +
            ".slip-field span{display:block;font-size:8.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#345b70}" +
            ".slip-field strong{display:block;min-height:18px;border-bottom:1px solid #78a7ba;padding:3px 2px 1px;font-size:11px;font-weight:500;color:#173244}" +
            ".check-row{display:flex;flex-wrap:wrap;gap:7px 13px;margin:5px 0 2px}" +
            ".slip-check{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-weight:700}" +
            ".check-box{width:13px;height:13px;border:1.5px solid #4f93aa;display:inline-grid;place-items:center;font-size:10px;line-height:1;font-weight:900;color:#0e5670;background:#fbfdfe}" +
            ".two-panel{display:grid;grid-template-columns:1.05fr .95fr;gap:10px;align-items:start}" +
            ".panel{border:1px solid #83b4c5;background:#f6fbfd;padding:8px;min-height:118px}" +
            ".panel-title{font-weight:800;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;color:#0e5670}" +
            ".teeth{display:grid;gap:5px;margin-top:5px}" +
            ".tooth-row{display:grid;grid-template-columns:repeat(16,1fr);gap:3px}" +
            ".tooth-cell{position:relative;min-height:26px;border:1px solid #78a7ba;text-align:center;font-weight:800;background:#fff;padding:2px 0 0;color:#173244}" +
            ".tooth-cell span{display:block;font-size:9px}.tooth-cell b{display:block;font-size:13px;line-height:12px}" +
            ".tooth-cell.selected{background:#c8eaf3;color:#0e5670;border-color:#1682a1;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
            ".text-block{border:1px solid #83b4c5;margin-top:7px;background:#fff}" +
            ".block-label{font-weight:800;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #83b4c5;padding:4px 6px;background:#eaf6fa;color:#0e5670;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
            ".block-lines{min-height:48px;padding:6px;white-space:normal}" +
            ".small .block-lines{min-height:32px}" +
            ".footer{display:grid;grid-template-columns:1fr auto;gap:10px;border-top:2px solid #6fa9bd;margin-top:9px;padding-top:7px;font-size:10px;color:#38576a}" +
            ".footer strong{font-size:13px;text-transform:uppercase;color:#0e5670}" +
            "@media print{body{background:#fff;font-size:10.1px;line-height:1.22}.sheet{padding:2mm;max-width:none;height:10.32in;display:flex}.slip{border:1.25px solid #6fa9bd;padding:10px 12px;width:100%;height:100%;display:flex;flex-direction:column}.top{padding-bottom:7px}.practice{font-size:21px}.subtitle{font-size:10.5px}.date-box{min-width:165px}.section-title{break-after:avoid;margin:7px 0 4px;padding:3px 7px}.grid{gap:5.5px}.slip-field span{font-size:8.1px}.slip-field strong{min-height:16px;padding:2px 2px 0;font-size:10.1px}.check-row{gap:6px 11px;margin:4px 0 1px}.check-box{width:12px;height:12px;font-size:9px}.two-panel{gap:8px}.panel{min-height:96px;padding:7px}.panel-title{margin-bottom:5px}.teeth{gap:4px}.tooth-row{gap:2.5px}.tooth-cell{min-height:23px;padding-top:1px}.tooth-cell span{font-size:8.5px}.tooth-cell b{font-size:12px;line-height:10px}.text-block{margin-top:5.5px;display:grid;grid-template-rows:auto 1fr;flex:1 1 0}.block-label{padding:3px 6px}.block-lines{min-height:42px;padding:5px}.small .block-lines{min-height:28px}.footer{margin-top:7px;padding-top:5px;font-size:9px}.footer strong{font-size:12px}.panel,.text-block{break-inside:avoid}}" +
            "</style></head><body><div class=\"sheet\"><div class=\"slip\">" +
            "<div class=\"top\"><div><div class=\"practice\">McMurtrey Endodontics</div><div class=\"subtitle\">Patient Referral Slip</div></div><div class=\"date-box\">" +
            slipField("Today's Date", new Date().toLocaleDateString()) + "</div></div>" +
            "<div class=\"section-title\">Patient Information</div>" +
            "<div class=\"grid cols-4\">" +
            slipField("First Name", fields.firstName) +
            slipField("Last Name", fields.lastName) +
            slipField("Date of Birth", prettyDate(fields.dob)) +
            slipField("Phone", fields.phone) +
            "</div><div class=\"grid cols-3\">" +
            slipField("Email", fields.email) +
            slipField("Sex", fields.sex) +
            slipField("Antibiotic Premedication Needed?", "") +
            "</div>" +
            "<div class=\"section-title\">Referring Doctor Information</div>" +
            "<div class=\"grid cols-4\">" +
            slipField("Referred By", fields.refDoc) +
            slipField("Practice", fields.refPractice) +
            slipField("Telephone", fields.refPhone) +
            slipField("Email Address", fields.refEmail) +
            "</div>" +
            "<div class=\"section-title\">Please Verify Teeth For Evaluation / Treatment</div>" +
            "<div class=\"teeth\"><div class=\"tooth-row\">" + topTeeth + "</div><div class=\"tooth-row\">" + bottomTeeth + "</div></div>" +
            "<div class=\"two-panel\">" +
            "<div class=\"panel\"><div class=\"panel-title\">Requested Procedure</div><div class=\"check-row\">" +
            slipCheck("Exam & Pulp Test", reasonIsSelected(reasons, "Exam & Pulp Test")) +
            slipCheck("Root Canal Therapy", reasonIsSelected(reasons, "Root Canal Therapy")) +
            slipCheck("Retreatment", reasonIsSelected(reasons, "Retreatment")) +
            slipCheck("Periapical Surgery", reasonIsSelected(reasons, "Periapical Surgery")) +
            slipCheck("Bleaching", reasonIsSelected(reasons, "Bleaching")) +
            slipCheck("Other", reasons.length > 0 && reasons.every(function (reason) { return ["Exam & Pulp Test", "Root Canal Therapy", "Retreatment", "Periapical Surgery", "Bleaching"].indexOf(reason) < 0; })) +
            "</div>" + slipField("Urgency", fields.urgency) + "</div>" +
            "<div class=\"panel\"><div class=\"panel-title\">Radiographs / Clinical Photos</div><div class=\"check-row\">" +
            slipCheck("Will be sent separately", fields.okXrays === "true") +
            slipCheck("No X-rays available", false) +
            "</div>" + slipField("Delivery Note", fields.xrayDeliveryNote) + "</div></div>" +
            "<div class=\"section-title\">Clinical Information</div>" +
            slipTextBlock("Chief Complaint / Symptoms", fields.symptoms) +
            slipTextBlock("Pertinent Dental History", fields.hx) +
            slipTextBlock("Medications / Allergies", fields.meds) +
            slipTextBlock("Referring Doctor Notes / Comments", fields.refNotes) +
            "<div class=\"section-title\">Insurance</div>" +
            "<div class=\"check-row\">" + slipCheck("No insurance / self-pay", fields.noInsurance === "true") + "</div>" +
            "<div class=\"grid cols-4\">" +
            slipField("Company", fields.insCompany) +
            slipField("Group #", fields.groupNum) +
            slipField("Member ID", fields.memberId) +
            slipField("Subscriber", fields.subscriber) +
            "</div><div class=\"grid cols-3\">" +
            slipField("Plan Max / Left", [fields.planMax, fields.maxLeft].filter(Boolean).join(" / ")) +
            slipField("Deductible / Left", [fields.deductible, fields.dedLeft].filter(Boolean).join(" / ")) +
            slipField("Insurance Phone", fields.insPhone) +
            "</div>" +
            "<div class=\"footer\"><div><strong>McMurtrey Endodontics</strong><br>Endodontic diagnosis and treatment referrals</div><div>p: 303.422.6464<br>office@mcmurtreyendo.com</div></div>" +
            "</div></div></body></html>";
    }

    function saveReferralForConfirmation(fields) {
        try {
            sessionStorage.setItem(STORAGE_FIELDS, JSON.stringify(fields));
            sessionStorage.setItem(STORAGE_PRINT_HTML, buildPrintableHTML(fields));
        } catch (error) {
        }
    }

    function downloadHtmlCopy(fields) {
        var html = buildPrintableHTML(fields);
        var url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
        var link = document.createElement("a");
        link.href = url;
        link.download = filenameFor(fields) + ".html";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(function () {
            URL.revokeObjectURL(url);
        }, 500);
    }

    function openPrintableCopy(fields) {
        var html = buildPrintableHTML(fields);
        var printWindow = window.open("", "_blank");

        if (!printWindow) {
            downloadHtmlCopy(fields);
            return;
        }

        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        printWindow.setTimeout(function () {
            printWindow.print();
        }, 250);
    }

    function hiddenFormPost(fields) {
        return new Promise(function (resolve) {
            var iframe = document.createElement("iframe");
            iframe.name = "referralSubmitFrame";
            iframe.style.display = "none";
            document.body.appendChild(iframe);

            var postForm = document.createElement("form");
            postForm.action = GAS_URL;
            postForm.method = "POST";
            postForm.target = iframe.name;
            postForm.style.display = "none";

            Object.keys(fields).forEach(function (key) {
                var input = document.createElement("input");
                input.type = "hidden";
                input.name = key;
                input.value = fields[key];
                postForm.appendChild(input);
            });

            document.body.appendChild(postForm);
            postForm.submit();

            window.setTimeout(function () {
                postForm.remove();
                iframe.remove();
                resolve(true);
            }, 1800);
        });
    }

    async function sendReferral(fields) {
        var body = new URLSearchParams(fields).toString();

        try {
            await fetch(GAS_URL, {
                method: "POST",
                mode: "no-cors",
                headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
                body: body
            });
            return true;
        } catch (error) {
        }

        try {
            if (navigator.sendBeacon && navigator.sendBeacon(GAS_URL, new Blob([body], {
                type: "application/x-www-form-urlencoded;charset=UTF-8"
            }))) {
                return true;
            }
        } catch (error) {
        }

        return hiddenFormPost(fields);
    }

    function appendReviewXraySummary() {
        if (updatingReview || !reviewPane) return;
        updatingReview = true;
        correctReviewDob();

        var oldSummary = reviewPane.querySelector("[data-xray-summary]");
        if (oldSummary) oldSummary.remove();

        var note = formValue("xrayDeliveryNote");
        var sendingSeparately = isChecked("okXrays");
        if (!note && !sendingSeparately) {
            updatingReview = false;
            return;
        }

        var summary = document.createElement("div");
        summary.className = "kv";
        summary.setAttribute("data-xray-summary", "true");

        var label = document.createElement("div");
        label.textContent = "X-rays";

        var value = document.createElement("div");
        value.textContent = note || "Radiographs will be sent separately.";

        summary.appendChild(label);
        summary.appendChild(value);
        reviewPane.appendChild(summary);
        updatingReview = false;
    }

    function hideOriginalToast() {
        document.querySelectorAll(".toast").forEach(function (toast) {
            toast.style.display = "none";
            toast.setAttribute("aria-hidden", "true");
        });
    }

    function syncPrintButtonVisibility() {
        var activeStep = form.querySelector("fieldset.active");
        var isReviewStep = activeStep && activeStep.getAttribute("data-step") === "5";
        if (downloadBtn) downloadBtn.style.display = isReviewStep ? "inline-flex" : "none";
    }

    function removeLegacyDialog() {
        document.querySelectorAll(".success-dialog").forEach(function (dialog) {
            dialog.remove();
        });
    }

    function suppressOriginalToastBriefly() {
        hideOriginalToast();
        var attempts = 0;
        var timer = window.setInterval(function () {
            hideOriginalToast();
            attempts += 1;
            if (attempts > 12) window.clearInterval(timer);
        }, 300);
    }

    function redirectToConfirmation(fields) {
        var params = new URLSearchParams();
        params.set("status", "sent");
        if (fields.okXrays === "true" || fields.xrayDeliveryNote) params.set("xray", "1");
        window.location.href = CONFIRMATION_PAGE + "?" + params.toString();
    }

    function activeStepNumber() {
        var activeStep = form.querySelector("fieldset.active");
        return activeStep ? Number(activeStep.getAttribute("data-step")) : 1;
    }

    function showStepError(step, message) {
        var error = document.getElementById("err" + step);
        if (!error) return;
        error.textContent = message;
        error.style.display = "block";
    }

    function clearStepError(step) {
        var error = document.getElementById("err" + step);
        if (!error) return;
        error.textContent = "";
        error.style.display = "none";
    }

    function validateRequiredProgression(step) {
        if (step === 3 && selectedReasons().length === 0) {
            showStepError(3, "Please select at least one reason for visit.");
            return false;
        }

        if (step === 4 && selectedTeeth().length === 0) {
            showStepError(4, "Please select at least one tooth number.");
            return false;
        }

        clearStepError(step);
        return true;
    }

    function legacyPickForTooth(toothNumber) {
        var teeth = Array.prototype.slice.call(document.querySelectorAll(".legacy-tooth-grid .tooth"));
        var match = teeth.filter(function (tooth) {
            var label = tooth.querySelector(".n");
            return label && label.textContent.trim() === String(toothNumber);
        })[0];
        return match ? match.querySelector(".pick") : null;
    }

    function syncChartButtons() {
        var selected = selectedTeeth();
        var selectedText = document.getElementById("selectedTeethText");

        document.querySelectorAll(".chart-pick").forEach(function (button) {
            var isSelected = selected.indexOf(button.getAttribute("data-tooth")) > -1;
            button.classList.toggle("active", isSelected);
            button.setAttribute("aria-pressed", isSelected ? "true" : "false");
        });

        if (selectedText) {
            selectedText.textContent = selected.length ? selected.join(", ") : "None";
        }
    }

    function buildToothChartSelector() {
        var overlay = document.getElementById("toothChartOverlay");
        if (!overlay || overlay.children.length) return;

        var teeth = [
            { number: 1, x: 2.4803, y: 19.6167, width: 4.9605, height: 19.7294 },
            { number: 2, x: 7.779, y: 15.4453, width: 6.0879, height: 23.5626 },
            { number: 3, x: 14.0924, y: 14.7689, width: 6.2007, height: 23.6753 },
            { number: 4, x: 21.2514, y: 13.3033, width: 4.4532, height: 26.2683 },
            { number: 5, x: 26.832, y: 10.372, width: 4.5096, height: 28.6359 },
            { number: 6, x: 32.3563, y: 7.1026, width: 5.1297, height: 32.5817 },
            { number: 7, x: 38.5569, y: 11.1612, width: 4.3405, height: 28.2976 },
            { number: 8, x: 43.8557, y: 11.8377, width: 5.4115, height: 27.6212 },
            { number: 9, x: 52.4239, y: 11.3867, width: 5.3551, height: 27.9594 },
            { number: 10, x: 58.6809, y: 10.7103, width: 4.3968, height: 28.7486 },
            { number: 11, x: 64.1488, y: 6.8771, width: 5.186, height: 32.8072 },
            { number: 12, x: 70.4622, y: 10.7103, width: 4.5096, height: 28.8613 },
            { number: 13, x: 75.8737, y: 13.3033, width: 4.3405, height: 26.2683 },
            { number: 14, x: 81.0598, y: 14.7689, width: 6.257, height: 23.9008 },
            { number: 15, x: 87.5423, y: 15.5581, width: 6.0879, height: 23.9008 },
            { number: 16, x: 93.9684, y: 19.6167, width: 5.0733, height: 19.8422 },
            { number: 17, x: 2.1984, y: 58.2864, width: 5.7497, height: 21.646 },
            { number: 18, x: 8.2864, y: 58.2864, width: 6.3134, height: 24.1263 },
            { number: 19, x: 15.0507, y: 57.7227, width: 6.7644, height: 25.0282 },
            { number: 20, x: 22.5479, y: 58.9628, width: 3.7768, height: 24.4645 },
            { number: 21, x: 27.7903, y: 58.9628, width: 3.7204, height: 24.4645 },
            { number: 22, x: 33.6528, y: 58.9628, width: 4.115, height: 26.7193 },
            { number: 23, x: 39.4589, y: 59.0755, width: 3.664, height: 26.0428 },
            { number: 24, x: 44.6449, y: 59.0755, width: 4.0586, height: 26.1556 },
            { number: 25, x: 52.4239, y: 59.1883, width: 3.8895, height: 26.1556 },
            { number: 26, x: 58.6809, y: 59.0755, width: 3.7204, height: 26.1556 },
            { number: 27, x: 64.1488, y: 59.0755, width: 4.1714, height: 26.832 },
            { number: 28, x: 70.2931, y: 59.0755, width: 3.664, height: 24.5772 },
            { number: 29, x: 75.5355, y: 58.9628, width: 3.7768, height: 24.69 },
            { number: 30, x: 79.9324, y: 57.9481, width: 6.6516, height: 24.9154 },
            { number: 31, x: 86.9786, y: 58.2864, width: 6.3134, height: 24.4645 },
            { number: 32, x: 93.5738, y: 58.3991, width: 5.6933, height: 21.9842 }
        ];

        teeth.forEach(function (tooth) {
            var button = document.createElement("button");
            button.type = "button";
            button.className = "chart-pick " + (tooth.number <= 16 ? "upper" : "lower");
            button.innerHTML = "<span>" + tooth.number + "</span>";
            button.setAttribute("data-tooth", String(tooth.number));
            button.setAttribute("aria-label", "Select tooth " + tooth.number);
            button.setAttribute("aria-pressed", "false");
            button.style.left = tooth.x + "%";
            button.style.top = tooth.y + "%";
            button.style.width = tooth.width + "%";
            button.style.height = tooth.height + "%";
            button.addEventListener("click", function () {
                var legacyPick = legacyPickForTooth(tooth.number);
                if (legacyPick) legacyPick.click();
                window.setTimeout(function () {
                    syncChartButtons();
                    clearStepError(4);
                }, 0);
            });
            overlay.appendChild(button);
        });

        syncChartButtons();
    }

    ["okXrays", "xrayDeliveryNote"].forEach(function (id) {
        var input = document.getElementById(id);
        if (input) input.addEventListener("input", appendReviewXraySummary);
        if (input) input.addEventListener("change", appendReviewXraySummary);
    });

    document.addEventListener("click", function (event) {
        var nextButton = event.target.closest("#nextBtn");
        var stepButton = event.target.closest(".step");
        var currentStep = activeStepNumber();
        var targetStep = stepButton ? Number(stepButton.getAttribute("data-step")) : currentStep;
        var isAdvancing = !!nextButton || (stepButton && targetStep > currentStep);

        if (!isAdvancing || validateRequiredProgression(currentStep)) return;

        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);

    document.addEventListener("click", function (event) {
        if (event.target.closest("#reasonChips .chip")) clearStepError(3);
        if (event.target.closest(".pick") || event.target.closest(".chart-pick")) clearStepError(4);
    });

    buildToothChartSelector();

    var legacyToothGrid = document.querySelector(".legacy-tooth-grid");
    if (legacyToothGrid) {
        var toothObserver = new MutationObserver(syncChartButtons);
        toothObserver.observe(legacyToothGrid, { attributes: true, subtree: true, attributeFilter: ["class", "aria-pressed"] });
    }

    var clearTeethButton = document.getElementById("clearTeeth");
    if (clearTeethButton) {
        clearTeethButton.addEventListener("click", function () {
            window.setTimeout(syncChartButtons, 0);
        });
    }

    form.addEventListener("keydown", function (event) {
        var target = event.target;
        var tagName = target && target.tagName ? target.tagName.toLowerCase() : "";

        if (event.key !== "Enter" || tagName === "textarea") return;

        event.preventDefault();
        event.stopImmediatePropagation();

        var nextBtn = document.getElementById("nextBtn");
        if (nextBtn && nextBtn.style.display !== "none") nextBtn.click();
    }, true);

    if (downloadBtn) {
        downloadBtn.addEventListener("click", function () {
            if (!requiredFieldsAreFilled()) {
                var firstMissing = ["firstName", "lastName", "dob", "phone", "refDoc"].map(function (id) {
                    return document.getElementById(id);
                }).filter(function (input) {
                    return input && !String(input.value || "").trim();
                })[0];

                if (firstMissing) firstMissing.focus();
                return;
            }

            var fields = payloadFields();
            saveReferralForConfirmation(fields);
            openPrintableCopy(fields);
        });
    }

    syncPrintButtonVisibility();

    form.addEventListener("submit", async function (event) {
        if (!requiredFieldsAreFilled()) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        suppressOriginalToastBriefly();

        var fields = payloadFields();
        var buttons = form.querySelectorAll("button");
        var originalSubmitText = submitBtn ? submitBtn.textContent : "";

        saveReferralForConfirmation(fields);

        buttons.forEach(function (button) {
            button.disabled = true;
        });
        if (submitBtn) submitBtn.textContent = "Sending...";

        try {
            await sendReferral(fields);
            redirectToConfirmation(fields);
        } catch (error) {
            redirectToConfirmation(fields);
        } finally {
            removeLegacyDialog();
            buttons.forEach(function (button) {
                button.disabled = false;
            });
            if (submitBtn) submitBtn.textContent = originalSubmitText;
        }
    }, true);

    if (reviewPane) {
        var reviewObserver = new MutationObserver(appendReviewXraySummary);
        reviewObserver.observe(reviewPane, { childList: true });
    }

    var stepObserver = new MutationObserver(syncPrintButtonVisibility);
    stepObserver.observe(form, { attributes: true, subtree: true, attributeFilter: ["class", "style"] });

    var legacyDialogObserver = new MutationObserver(removeLegacyDialog);
    legacyDialogObserver.observe(document.body, { childList: true });
}());
