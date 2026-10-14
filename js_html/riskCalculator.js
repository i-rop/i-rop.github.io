// Page behaviour for the 2-week TR-ROP risk calculator (risk-calculator.html).
// The model itself is in riskModel.js.

(function() {  // anonymous function to not pollute the DOM (global namespace)

    var limits = RiskModel.LIMITS;

    // keys match RiskModel.LIMITS
    var fields = {
        gaWeeks:  $('#rc-ga-weeks'),
        gaDays:   $('#rc-ga-days'),
        pmaWeeks: $('#rc-pma-weeks'),
        pmaDays:  $('#rc-pma-days'),
        pscore:   $('#rc-pscore')
    };

    var names = {
        gaWeeks:  'Gestational age (weeks)',
        gaDays:   'Gestational age (days)',
        pmaWeeks: 'Postmenstrual age (weeks)',
        pmaDays:  'Postmenstrual age (days)',
        pscore:   'P-score'
    };

    var form = $('#rc-form');
    var problemsBox = $('#rc-problems');

    // whole-number value of an input, or NaN if it is empty or not a whole number
    var readInt = function(input) {
        var text = $.trim(input.val());
        return /^\d+$/.test(text) ? parseInt(text, 10) : NaN;
    };

    var inRange = function(key, value) {
        return !isNaN(value) && value >= limits[key].min && value <= limits[key].max;
    };

    // Keeps PMA at or above GA (and 30 weeks), as the Shiny app did. Waits until all four ages are
    // whole numbers and GA is in range; anything else is reported when Calculate is pressed.
    var syncPma = function() {
        var gaWeeks = readInt(fields.gaWeeks);
        var gaDays = readInt(fields.gaDays);
        var pmaWeeks = readInt(fields.pmaWeeks);
        var pmaDays = readInt(fields.pmaDays);

        if (isNaN(gaWeeks) || isNaN(gaDays) || isNaN(pmaWeeks) || isNaN(pmaDays)) { return; }
        if (!inRange('gaWeeks', gaWeeks) || !inRange('gaDays', gaDays)) { return; }

        var pma = RiskModel.constrainPma(gaWeeks, gaDays, pmaWeeks, pmaDays);
        fields.pmaWeeks.attr('min', pma.minWeeks).val(pma.weeks);
        fields.pmaDays.attr('min', pma.minDays).val(pma.days);
    };

    // Flags every input that is not a whole number inside its range.
    var validate = function() {
        var values = {};
        var problems = [];
        var firstBad = null;

        $.each(fields, function(key, input) {
            var value = readInt(input);
            var ok = inRange(key, value);

            input.closest('.form-group').toggleClass('has-error', !ok);
            if (ok) {
                input.removeAttr('aria-invalid');
                values[key] = value;
            } else {
                input.attr('aria-invalid', 'true');
                problems.push(names[key] + ' must be a whole number from ' + limits[key].min + ' to ' + limits[key].max + '.');
                firstBad = firstBad || input;
            }
        });

        return { values: values, problems: problems, firstBad: firstBad };
    };

    var showProblems = function(problems) {
        var list = $('<ul></ul>');
        $.each(problems, function(i, text) {
            list.append($('<li></li>').text(text));
        });
        problemsBox.empty().append(list).prop('hidden', false);
    };

    var clearProblems = function() {
        problemsBox.empty().prop('hidden', true);
        $.each(fields, function(key, input) {
            input.closest('.form-group').removeClass('has-error');
            input.removeAttr('aria-invalid');
        });
    };

    var showResult = function(result) {
        $('#rc-badge')
            .text(result.label)
            .toggleClass('rc-badge-low', result.isLow)
            .toggleClass('rc-badge-high', !result.isLow);
        $('#rc-params').text(
            'GA:  ' + result.ga.toFixed(1) + ' weeks\n' +
            'PMA: ' + result.pma.toFixed(1) + ' weeks\n' +
            'P-score: ' + result.pscore
        );
        $('#rc-placeholder').prop('hidden', true);
        $('#rc-result').prop('hidden', false);
    };

    var clearResult = function() {
        $('#rc-result').prop('hidden', true);
        $('#rc-placeholder').prop('hidden', false);
    };

    $.each(fields, function(key, input) {
        input.attr({ min: limits[key].min, max: limits[key].max });
    });

    // PMA follows GA once an age has been entered (change fires on blur, Enter and the spinner buttons)
    fields.gaWeeks.add(fields.gaDays).add(fields.pmaWeeks).add(fields.pmaDays).on('change', syncPma);

    form.on('input', clearProblems);

    form.on('submit', function(event) {
        event.preventDefault();
        syncPma();

        var check = validate();
        if (check.problems.length) {
            showProblems(check.problems);
            clearResult();
            check.firstBad.focus();
            return;
        }

        clearProblems();
        var v = check.values;
        showResult(RiskModel.calculate(v.gaWeeks, v.gaDays, v.pmaWeeks, v.pmaDays, v.pscore));
    });

    syncPma();

    // Shown on every load; the modal only closes with its button. Wait for the window load event:
    // loadCss.js adds the stylesheets late, and if the modal is opened before bootstrap's css has
    // arrived it never becomes visible while its backdrop stays up, which leaves the page unusable.
    $(window).on('load', function() {
        $('#rc-ack-modal').modal('show');
    });

})();
