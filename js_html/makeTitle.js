
(function() {  // anonymous function to not pollute the DOM (global namespace)

    var titleElem = document.getElementById("main-title");

    // To use an html string, use innerHTML field. For trade offs, see
    // https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent
    //
    titleElem.textContent = "i-ROP Imaging and Informatics in Retinopathy of Prematurity";
    
})();
