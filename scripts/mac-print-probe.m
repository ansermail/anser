// Native integration probe: fictional content only; never opens a printer panel.
#import <AppKit/AppKit.h>
#import <PDFKit/PDFKit.h>
#import <WebKit/WebKit.h>
#import "../src-tauri/src/macos_print.m"

@interface AnserPrintProbe : NSObject <NSApplicationDelegate, WKNavigationDelegate>
@property NSWindow *window;
@property WKWebView *web;
@end

@implementation AnserPrintProbe
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1000, 800)
                                            styleMask:NSWindowStyleMaskTitled
                                              backing:NSBackingStoreBuffered defer:NO];
    self.web = [[WKWebView alloc] initWithFrame:self.window.contentView.bounds];
    self.web.navigationDelegate = self;
    self.window.contentView = self.web;
    NSURL *url = [NSURL fileURLWithPath:NSProcessInfo.processInfo.arguments[1]];
    [self.web loadFileURL:url allowingReadAccessToURL:url.URLByDeletingLastPathComponent];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        fprintf(stderr, "Native print probe timed out\n");
        exit(2);
    });
}

- (void)webView:(WKWebView *)web didFinishNavigation:(WKNavigation *)navigation {
    [web evaluateJavaScript:@"JSON.stringify({sheet:!!document.getElementById('mail-print-root'),error:window.probeError})" completionHandler:^(id value, NSError *error) {
        fprintf(stdout, "document=%s error=%s\n", [[value description] UTF8String], [[error description] UTF8String]);
        NSPrintInfo *info = anserMailPrintInfo();
        info.jobDisposition = NSPrintSaveJob;
        info.dictionary[NSPrintJobSavingURL] = [NSURL fileURLWithPath:NSProcessInfo.processInfo.arguments[2]];
        NSPrintOperation *operation = [web printOperationWithPrintInfo:info];
        operation.showsPrintPanel = NO;
        operation.showsProgressPanel = NO;
        // WebKit needs the secondary thread to wait for the actual page count
        // when the preview panel is omitted.
        operation.canSpawnSeparateThread = YES;
        [operation runOperationModalForWindow:self.window delegate:self
                              didRunSelector:@selector(printOperation:didRun:contextInfo:) contextInfo:NULL];
    }];
}

- (void)printOperation:(NSPrintOperation *)operation didRun:(BOOL)success contextInfo:(void *)context {
    PDFDocument *pdf = [[PDFDocument alloc] initWithURL:[NSURL fileURLWithPath:NSProcessInfo.processInfo.arguments[2]]];
    NSMutableString *text = [NSMutableString string];
    BOOL valid = success && pdf.pageCount > 1 && pdf.pageCount < 20;
    for (NSUInteger index = 0; index < pdf.pageCount; index++) {
        PDFPage *page = [pdf pageAtIndex:index];
        NSRect box = [page boundsForBox:kPDFDisplayBoxMediaBox];
        valid &= fabs(box.size.width - 595) < 1 && fabs(box.size.height - 842) < 1;
        valid &= page.string.length > 0;
        [text appendString:page.string ?: @""];
        [text appendString:@"\n"];
    }
    NSUInteger previous = 0;
    for (int index = 1; index <= 60; index++) {
        NSString *marker = [NSString stringWithFormat:@"PARAGRAPH-%03d", index];
        NSRange found = [text rangeOfString:marker];
        valid &= [text componentsSeparatedByString:marker].count == 2;
        valid &= found.location != NSNotFound && found.location >= previous;
        previous = found.location;
    }
    valid &= ![text containsString:@"Application UI must not print"];
    valid &= [text containsString:@"DOCUMENT-END-060"];
    valid &= [text containsString:@"draft-validation.txt"];
    PDFSelection *title = [pdf findString:@"Anser native print regression" fromSelection:nil withOptions:0];
    PDFPage *first = [pdf pageAtIndex:0];
    NSRect titleBox = [title boundsForPage:first];
    CGFloat top = NSMaxY([first boundsForBox:kPDFDisplayBoxMediaBox]) - NSMaxY(titleBox);
    // Text ink starts a few points below the 16mm (45.35pt) page inset.
    valid &= title && title.pages.firstObject == first;
    valid &= titleBox.origin.x > 44 && titleBox.origin.x < 47;
    valid &= top > 44 && top < 55;
    fprintf(stdout, "pages=%lu titleLeft=%.2fpt titleTop=%.2fpt complete=%s\n",
            (unsigned long)pdf.pageCount, titleBox.origin.x, top, valid ? "yes" : "NO");
    exit(valid ? 0 : 1);
}
@end

int main(int argc, const char **argv) {
    @autoreleasepool {
        NSApplication *app = NSApplication.sharedApplication;
        AnserPrintProbe *probe = [AnserPrintProbe new];
        app.delegate = probe;
        [app run];
    }
}
