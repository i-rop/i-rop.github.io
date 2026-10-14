/* i-ROP site script: mobile menu and image lightbox. No dependencies. */
(function () {
    'use strict';

    /* ---- Mobile menu -------------------------------------------------------
       Below 64rem the menu collapses behind a button (see the .js rules in site.css).
       Without JavaScript the links simply stay visible. */
    var toggle = document.querySelector('.nav-toggle');
    var nav = document.getElementById('site-nav');

    if (toggle && nav) {
        var setOpen = function (open) {
            nav.classList.toggle('is-open', open);
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        };

        toggle.addEventListener('click', function () {
            setOpen(toggle.getAttribute('aria-expanded') !== 'true');
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
                setOpen(false);
                toggle.focus();
            }
        });

        nav.addEventListener('click', function (event) {
            if (event.target.closest('a')) { setOpen(false); }
        });

        window.matchMedia('(min-width: 64rem)').addEventListener('change', function (query) {
            if (query.matches) { setOpen(false); }
        });
    }

    /* ---- Lightbox ----------------------------------------------------------
       <a class="zoom" href="big.jpg"><img src="big.jpg" alt="..."></a> opens in a native <dialog>.
       Without JavaScript (or with a modified click) the link just opens the image. */
    var zoomLinks = document.querySelectorAll('a.zoom');

    if (zoomLinks.length && typeof HTMLDialogElement === 'function') {
        var dialog = document.createElement('dialog');
        dialog.className = 'lightbox';
        dialog.setAttribute('aria-label', 'Enlarged image');
        dialog.innerHTML =
            '<div class="lightbox-inner">' +
                '<button type="button" class="lightbox-close">Close</button>' +
                '<img alt="">' +
                '<p></p>' +
            '</div>';
        document.body.appendChild(dialog);

        var bigImage = dialog.querySelector('img');
        var caption = dialog.querySelector('p');

        dialog.addEventListener('click', function (event) {
            // a click on the backdrop (outside the picture) or on the button closes it
            if (event.target === dialog || event.target.closest('.lightbox-close')) { dialog.close(); }
        });
        dialog.addEventListener('close', function () { bigImage.removeAttribute('src'); });

        Array.prototype.forEach.call(zoomLinks, function (link) {
            link.addEventListener('click', function (event) {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) { return; }
                event.preventDefault();

                var thumb = link.querySelector('img');
                var figure = link.closest('figure');
                var figcaption = figure && figure.querySelector('figcaption');

                bigImage.src = link.href;
                bigImage.alt = thumb ? thumb.alt : '';
                caption.textContent = figcaption ? figcaption.textContent.trim() : '';
                caption.hidden = !figcaption;
                dialog.showModal();
            });
        });
    }
})();
