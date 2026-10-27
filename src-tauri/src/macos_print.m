#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

static NSPrintInfo *anserMailPrintInfo(void) {
    // Use an independent job: inherited scaling/centering or changes in this
    // panel must not change the system's shared printing preferences.
    NSPrintInfo *info = [NSPrintInfo.sharedPrintInfo copy];
    const CGFloat pointsPerMillimeter = 72.0 / 25.4;
    info.paperName = @"A4";
    info.orientation = NSPaperOrientationPortrait;
    info.paperSize = NSMakeSize(210.0 * pointsPerMillimeter,
                                297.0 * pointsPerMillimeter);
    info.scalingFactor = 1.0;
    info.horizontallyCentered = NO;
    info.verticallyCentered = NO;
    info.horizontalPagination = NSPrintingPaginationModeFit;
    info.verticalPagination = NSPrintingPaginationModeAutomatic;
    // Match CSS @page before WebKit computes the printable area. WebKit
    // replaces these with the computed CSS margins (it does not add them).
    // Starting at zero makes AppKit fit the full-paper layout into the later
    // inset area, shrinking the text and adding excessive space above it.
    const CGFloat margin = 16.0 * pointsPerMillimeter;
    info.topMargin = margin;
    info.rightMargin = margin;
    info.bottomMargin = margin;
    info.leftMargin = margin;
    return info;
}

int anser_print_mail_webview(void *pointer) {
    if (!pointer || !NSThread.isMainThread) return 1;
    @autoreleasepool {
        WKWebView *view = (__bridge WKWebView *)pointer;
        NSWindow *window = view.window;
        if (!window) return 1;
        @try {
            NSPrintOperation *operation = [view printOperationWithPrintInfo:anserMailPrintInfo()];
            operation.printPanel.options |= NSPrintPanelShowsPaperSize |
                                            NSPrintPanelShowsOrientation |
                                            NSPrintPanelShowsScaling;
            operation.canSpawnSeparateThread = YES;
            [operation runOperationModalForWindow:window
                                        delegate:nil
                                  didRunSelector:NULL
                                     contextInfo:NULL];
            return 0;
        } @catch (NSException *exception) {
            return 1;
        }
    }
}
