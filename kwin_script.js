print("KWIN_ACTIVE_APP_LOGGER_START");

function logActiveWindow(window) {
    if (window) {
        var resourceClass = window.resourceClass || "unknown";
        var caption = window.caption || "untitled";
        print("KWIN_ACTIVE_APP:" + resourceClass + ":" + caption);
    } else {
        print("KWIN_ACTIVE_APP:none:none");
    }
}

// Log initial active window
try {
    logActiveWindow(workspace.activeWindow);
} catch (e) {
    print("KWIN_ACTIVE_APP_ERROR: " + e.message);
}

// Log when active window changes
try {
    workspace.windowActivated.connect(function(window) {
        logActiveWindow(window);
    });
} catch (e) {
    print("KWIN_ACTIVE_APP_ERROR_CONNECT: " + e.message);
}
