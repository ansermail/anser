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
    // WebKit applies the document's @page 16mm margins. Additional AppKit
    // margins would inset the content twice.
    info.topMargin = 0;
    info.rightMargin = 0;
    info.bottomMargin = 0;
    info.leftMargin = 0;
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
