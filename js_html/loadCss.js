
(function() {  // anonymous function to not pollute the DOM (global namespace)


    // To extract this nifty utility, the site will need a top level namespace, something like "iRopApp"
    // then this function can become iRopApp.loadCssFile

    // might be nice to simply use the link as the id ...
    var loadCssFile = function(cssId, cssLink) {

        // from http://stackoverflow.com/questions/574944/how-to-load-up-css-files-using-javascript

        if (!document.getElementById(cssId))
        {
            var head  = document.getElementsByTagName('head')[0];
            var link  = document.createElement('link');
            link.id   = cssId;
            link.rel  = 'stylesheet';
            link.type = 'text/css';
            link.href = cssLink;  // e.g.  'http://website.com/css/stylesheet.css';
            link.media = 'all';
            head.appendChild(link);
        }
    }
    
    loadCssFile("bootstrap", "css/bootstrapedited.css");

    // <!-- Custom CSS -->
    loadCssFile("style", "css/style.css" );
    loadCssFile("custom", "css/custom.css");
    loadCssFile("footer", "css/footer.css");
    
    
})();    