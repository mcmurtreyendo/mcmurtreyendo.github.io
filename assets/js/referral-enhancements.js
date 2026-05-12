(function () {
    "use strict";

    var GAS_URL = "https://script.google.com/macros/s/AKfycbyEjJvFoBgHz8LMUt7dBauwHgIOByKnRR3N4ExpCXn3dk9zpkuQUogzC3f6Z7oAUtaxWQ/exec";
    var form = document.getElementById("refForm");
    var reviewPane = document.getElementById("reviewPane");
    var submitBtn = document.getElementById("submitBtn");
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
        return !!(input && input.checked);
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
            okXrays: isChecked("okXrays") ? "Yes" : "No",
            noInsurance: isChecked("noIns") ? "Yes" : "No",
            xrayDeliveryNote: formValue("xrayDeliveryNote"),
            reasons: JSON.stringify(selectedReasons()),
            teeth: JSON.stringify(selectedTeeth())
        };
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

    function suppressOriginalToastBriefly() {
        hideOriginalToast();
        var attempts = 0;
        var timer = window.setInterval(function () {
            hideOriginalToast();
            attempts += 1;
            if (attempts > 12) window.clearInterval(timer);
        }, 300);
    }

    function showSentMessage() {
        hideOriginalToast();

        var message = isChecked("okXrays") || formValue("xrayDeliveryNote")
            ? "Thank you. The referral has been submitted. Please send the X-rays separately using your secure radiograph delivery method."
            : "Thank you. The referral has been submitted to McMurtrey Endodontics.";

        var dialog = document.getElementById("referralSuccessDialog");
        if (!dialog) {
            dialog = document.createElement("div");
            dialog.id = "referralSuccessDialog";
            dialog.className = "success-dialog";
            dialog.setAttribute("role", "dialog");
            dialog.setAttribute("aria-modal", "true");
            dialog.setAttribute("aria-labelledby", "referralSuccessTitle");
            dialog.innerHTML = '<div class="success-card"><h2 id="referralSuccessTitle">Referral Sent!</h2><p id="referralSuccessMessage"></p><button type="button" class="btn secondary" id="referralSuccessClose">Close</button></div>';
            document.body.appendChild(dialog);
            document.getElementById("referralSuccessClose").addEventListener("click", function () {
                dialog.hidden = true;
                if (submitBtn) submitBtn.focus();
            });
        }

        document.getElementById("referralSuccessMessage").textContent = message;
        dialog.hidden = false;
        document.getElementById("referralSuccessClose").focus();
    }

    ["okXrays", "xrayDeliveryNote"].forEach(function (id) {
        var input = document.getElementById(id);
        if (input) input.addEventListener("input", appendReviewXraySummary);
        if (input) input.addEventListener("change", appendReviewXraySummary);
    });

    form.addEventListener("submit", async function (event) {
        if (!requiredFieldsAreFilled()) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        suppressOriginalToastBriefly();

        var buttons = form.querySelectorAll("button");
        buttons.forEach(function (button) {
            button.disabled = true;
        });

        try {
            await sendReferral(payloadFields());
            showSentMessage();
        } catch (error) {
            showSentMessage();
        } finally {
            buttons.forEach(function (button) {
                button.disabled = false;
            });
        }
    }, true);

    if (reviewPane) {
        var reviewObserver = new MutationObserver(appendReviewXraySummary);
        reviewObserver.observe(reviewPane, { childList: true });
    }
}());
