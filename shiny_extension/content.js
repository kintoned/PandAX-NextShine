(function() {
    'use strict';

    // Overwrite document.hidden and document.visibilityState
    Object.defineProperty(document, 'hidden', {
        get: function() { return false; },
        configurable: true
    });

    Object.defineProperty(document, 'visibilityState', {
        get: function() { return 'visible'; },
        configurable: true
    });

    Object.defineProperty(document, 'webkitHidden', {
        get: function() { return false; },
        configurable: true
    });

    Object.defineProperty(document, 'webkitVisibilityState', {
        get: function() { return 'visible'; },
        configurable: true
    });

    // Stop visibilitychange events
    const stopPropagation = function(e) {
        e.stopImmediatePropagation();
    };

    window.addEventListener('visibilitychange', stopPropagation, true);
    window.addEventListener('webkitvisibilitychange', stopPropagation, true);

    // Some games use window blur to detect background state
    window.addEventListener('blur', stopPropagation, true);

    // Some might check for focus
    window.addEventListener('focus', function(e) {
        // Allow focus events
    }, true);

    console.log('ShinyColors Always Sound: Visibility API mocked.');
})();
