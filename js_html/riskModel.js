// Risk model for the 2-week TR-ROP risk calculator (risk-calculator.html).
//
// Ported from the R Shiny app that was hosted at
// https://i-rop.shinyapps.io/weekly-risk-calculator/ (app.R). The coefficients,
// threshold, rounding and PMA rules below follow that code. If the model is ever
// refit, this is the only file that needs to change.

(function(root) {  // anonymous function to not pollute the DOM (global namespace)

    // Probabilities below this are reported as low risk.
    var THRESHOLD = 0.008;

    // Smallest postmenstrual age (weeks) the model accepts.
    var PMA_MIN_WEEKS = 30;

    // Documented input ranges. All inputs are whole numbers.
    var LIMITS = {
        gaWeeks:  { min: 22, max: 31 },
        gaDays:   { min: 0,  max: 6 },
        pmaWeeks: { min: PMA_MIN_WEEKS, max: 50 },
        pmaDays:  { min: 0,  max: 6 },
        pscore:   { min: 1,  max: 9 }
    };

    // weeks + days as decimal weeks, rounded to 1 decimal place (the model is applied to the rounded ages)
    var decimalWeeks = function(weeks, days) {
        return Math.round((weeks + days / 7) * 10) / 10;
    };

    var calculate = function(gaWeeks, gaDays, pmaWeeks, pmaDays, pscore) {
        var ga = decimalWeeks(gaWeeks, gaDays);
        var pma = decimalWeeks(pmaWeeks, pmaDays);

        // linear predictor (logit of the 2-week probability of treatment-requiring ROP)
        var linpred = -2.2268 - 0.361 * ga + 0.144 * pma + 3.450 * pscore - 0.074 * pma * pscore;
        var probability = 1 / (1 + Math.exp(-linpred));  // plogis()
        var isLow = probability < THRESHOLD;

        return {
            ga: ga,
            pma: pma,
            pscore: pscore,
            linpred: linpred,
            probability: probability,
            isLow: isLow,
            label: isLow ? 'Low Risk' : 'Intermediate to High Risk'
        };
    };

    // Postmenstrual age cannot be younger than gestational age, or under 30 weeks. These are the same
    // three rules the Shiny app applied to its PMA inputs; every rule looks at the same snapshot of the
    // inputs and the pass is repeated until nothing changes. Returns the settled PMA plus the lowest
    // weeks/days values the PMA inputs should currently allow.
    var constrainPma = function(gaWeeks, gaDays, pmaWeeks, pmaDays) {
        var minWeeks, minDays;

        for (var pass = 0; pass < 10; pass++) {
            minWeeks = Math.max(PMA_MIN_WEEKS, gaWeeks);
            minDays = (pmaWeeks === gaWeeks) ? gaDays : 0;

            var nextWeeks = pmaWeeks;
            var nextDays = pmaDays;
            if (pmaWeeks < minWeeks) { nextWeeks = minWeeks; }
            if (pmaDays < minDays) { nextDays = minDays; }
            if (pmaWeeks + pmaDays / 7 < gaWeeks + gaDays / 7) {
                nextWeeks = gaWeeks;
                nextDays = gaDays;
            }

            if (nextWeeks === pmaWeeks && nextDays === pmaDays) { break; }
            pmaWeeks = nextWeeks;
            pmaDays = nextDays;
        }

        return { weeks: pmaWeeks, days: pmaDays, minWeeks: minWeeks, minDays: minDays };
    };

    root.RiskModel = {
        THRESHOLD: THRESHOLD,
        LIMITS: LIMITS,
        calculate: calculate,
        constrainPma: constrainPma
    };

})(this);
