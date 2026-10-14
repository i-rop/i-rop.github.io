// Page behaviour for the 2-week TR-ROP risk calculator (index.html). The model itself is in model.js.

(function () {
    'use strict';

    const limits = RiskModel.LIMITS;

    // keys match RiskModel.LIMITS
    const fields = {
        gaWeeks: document.getElementById('rc-ga-weeks'),
        gaDays: document.getElementById('rc-ga-days'),
        pmaWeeks: document.getElementById('rc-pma-weeks'),
        pmaDays: document.getElementById('rc-pma-days'),
        pscore: document.getElementById('rc-pscore'),
    };

    const names = {
        gaWeeks: 'Gestational age (weeks)',
        gaDays: 'Gestational age (days)',
        pmaWeeks: 'Postmenstrual age (weeks)',
        pmaDays: 'Postmenstrual age (days)',
        pscore: 'P-score',
    };

    const form = document.getElementById('rc-form');
    const problemsBox = document.getElementById('rc-problems');
    const badge = document.getElementById('rc-badge');
    const paramsText = document.getElementById('rc-params');
    const placeholder = document.getElementById('rc-placeholder');
    const resultBox = document.getElementById('rc-result');

    // whole-number value of an input, or NaN if it is empty or not a whole number
    const readInt = (input) => {
        const text = input.value.trim();
        return /^\d+$/.test(text) ? parseInt(text, 10) : NaN;
    };

    const inRange = (key, value) => !Number.isNaN(value) && value >= limits[key].min && value <= limits[key].max;

    // Keeps PMA at or above GA (and 30 weeks), as the Shiny app did. Waits until all four ages are
    // whole numbers and GA is in range; anything else is reported when Calculate is pressed.
    const syncPma = () => {
        const gaWeeks = readInt(fields.gaWeeks);
        const gaDays = readInt(fields.gaDays);
        const pmaWeeks = readInt(fields.pmaWeeks);
        const pmaDays = readInt(fields.pmaDays);

        if ([gaWeeks, gaDays, pmaWeeks, pmaDays].some(Number.isNaN)) { return; }
        if (!inRange('gaWeeks', gaWeeks) || !inRange('gaDays', gaDays)) { return; }

        const pma = RiskModel.constrainPma(gaWeeks, gaDays, pmaWeeks, pmaDays);
        fields.pmaWeeks.min = pma.minWeeks;
        fields.pmaWeeks.value = pma.weeks;
        fields.pmaDays.min = pma.minDays;
        fields.pmaDays.value = pma.days;
    };

    // Flags every input that is not a whole number inside its range.
    const validate = () => {
        const values = {};
        const problems = [];
        let firstBad = null;

        Object.keys(fields).forEach((key) => {
            const input = fields[key];
            const value = readInt(input);
            const ok = inRange(key, value);

            input.closest('.rc-field').classList.toggle('has-error', !ok);
            if (ok) {
                input.removeAttribute('aria-invalid');
                values[key] = value;
            } else {
                input.setAttribute('aria-invalid', 'true');
                problems.push(`${names[key]} must be a whole number from ${limits[key].min} to ${limits[key].max}.`);
                firstBad = firstBad || input;
            }
        });

        return { values, problems, firstBad };
    };

    const showProblems = (problems) => {
        const list = document.createElement('ul');
        problems.forEach((text) => {
            const item = document.createElement('li');
            item.textContent = text;
            list.appendChild(item);
        });
        problemsBox.replaceChildren(list);
        problemsBox.hidden = false;
    };

    const clearProblems = () => {
        problemsBox.replaceChildren();
        problemsBox.hidden = true;
        Object.keys(fields).forEach((key) => {
            fields[key].closest('.rc-field').classList.remove('has-error');
            fields[key].removeAttribute('aria-invalid');
        });
    };

    const showResult = (result) => {
        badge.textContent = result.label;
        badge.classList.toggle('rc-badge-low', result.isLow);
        badge.classList.toggle('rc-badge-high', !result.isLow);
        paramsText.textContent =
            'GA:  ' + result.ga.toFixed(1) + ' weeks\n' +
            'PMA: ' + result.pma.toFixed(1) + ' weeks\n' +
            'P-score: ' + result.pscore;
        placeholder.hidden = true;
        resultBox.hidden = false;
    };

    const clearResult = () => {
        resultBox.hidden = true;
        placeholder.hidden = false;
    };

    Object.keys(fields).forEach((key) => {
        fields[key].min = limits[key].min;
        fields[key].max = limits[key].max;
    });

    // PMA follows GA once an age has been entered (change fires on blur, Enter and the spinner buttons)
    [fields.gaWeeks, fields.gaDays, fields.pmaWeeks, fields.pmaDays].forEach((input) => {
        input.addEventListener('change', syncPma);
    });

    form.addEventListener('input', clearProblems);

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        syncPma();

        const check = validate();
        if (check.problems.length) {
            showProblems(check.problems);
            clearResult();
            check.firstBad.focus();
            return;
        }

        clearProblems();
        const v = check.values;
        showResult(RiskModel.calculate(v.gaWeeks, v.gaDays, v.pmaWeeks, v.pmaDays, v.pscore));
    });

    syncPma();

    /* ---- Dialogs --------------------------------------------------------------------------
       Native <dialog> elements. In a browser without them the same text simply shows on the page. */
    const ack = document.getElementById('rc-ack');

    if (typeof ack.showModal === 'function') {
        // The acknowledgement is shown on every visit and only closes with its button.
        let acknowledged = false;
        const showAck = () => { if (!ack.open) { ack.showModal(); } };

        ack.addEventListener('cancel', (event) => event.preventDefault());      // Escape
        ack.addEventListener('close', () => { if (!acknowledged) { showAck(); } }); // a second Escape closes it anyway
        ack.querySelector('[data-ack]').addEventListener('click', () => {
            acknowledged = true;
            ack.close();
        });
        showAck();

        // "When to Use", "Considerations" and "Why Use": Escape, the close buttons or a click outside close them.
        document.querySelectorAll('[data-dialog]').forEach((button) => {
            const dialog = document.getElementById(button.dataset.dialog);
            button.addEventListener('click', () => dialog.showModal());
            dialog.addEventListener('click', (event) => {
                if (event.target === dialog || event.target.closest('[data-close]')) { dialog.close(); }
            });
        });
    }
})();
