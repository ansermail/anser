#import <AppKit/AppKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#include <stdlib.h>
#include <string.h>

static BOOL changing = NO; // Accessed only on the main queue.
static NSArray<NSString *> *extensions(void) { return @[@"eml", @"emlx", @"msg"]; }
static UTType *mailType(NSString *extension) {
    if (![extensions() containsObject:extension]) return nil;
    return [UTType typeWithFilenameExtension:extension];
}
static NSString *appName(NSURL *url) {
    NSBundle *bundle=[NSBundle bundleWithURL:url];
    return [bundle objectForInfoDictionaryKey:@"CFBundleDisplayName"] ?: [bundle objectForInfoDictionaryKey:@"CFBundleName"] ?: url.lastPathComponent.stringByDeletingPathExtension;
}
static NSString *appID(NSURL *url) { return [NSBundle bundleWithURL:url].bundleIdentifier ?: @""; }
// LaunchServices associates document types with a bundle identifier. When a
// development and installed copy share that identifier, it may return the
// installed URL even after setDefaultApplicationAtURL(developmentURL) succeeds.
static BOOL sameApp(NSURL *a,NSURL *b) { return a && b && appID(a).length && [appID(a) isEqualToString:appID(b)]; }
static char *json(id value) {
    NSData *data=[NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];
    if (!data) return strdup("{\"error\":\"associationFailed\"}");
    NSString *s=[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    return strdup(s.UTF8String);
}
char *anser_mail_associations_read(void) {
    __block char *answer=NULL;
    void (^read)(void)=^{ @autoreleasepool {
        NSWorkspace *workspace=NSWorkspace.sharedWorkspace;
        NSURL *own=NSBundle.mainBundle.bundleURL;
        NSMutableArray *rows=[NSMutableArray array];
        for (NSString *extension in extensions()) {
            UTType *type=mailType(extension); if (!type) continue;
            NSURL *current=[workspace URLForApplicationToOpenContentType:type];
            NSMutableArray *apps=[NSMutableArray array]; NSMutableSet *seen=[NSMutableSet set];
            NSMutableArray *urls=[NSMutableArray arrayWithArray:[workspace URLsForApplicationsToOpenContentType:type] ?: @[]];
            if ([own.pathExtension.lowercaseString isEqualToString:@"app"]) [urls insertObject:own atIndex:0];
            for (NSURL *url in urls) {
                NSString *identifier=sameApp(url,own)?@"self":appID(url);
                if (!identifier.length || [seen containsObject:identifier] || (![identifier isEqualToString:@"self"] && [identifier isEqualToString:NSBundle.mainBundle.bundleIdentifier])) continue;
                [seen addObject:identifier]; [apps addObject:@{@"id":identifier,@"name":appName(url)}];
            }
            [rows addObject:@{@"extension":extension,@"currentName":current?appName(current):@"",@"isDefault":@(sameApp(current,own)),@"currentId":current?(sameApp(current,own)?@"self":appID(current)):@"",@"applications":apps}];
        }
        answer=json(@{@"supported":@YES,@"busy":@(changing),@"items":rows});
    }};
    if (NSThread.isMainThread) read(); else dispatch_sync(dispatch_get_main_queue(),read);
    return answer;
}
char *anser_mail_association_set(const char *fileExtension,const char *applicationID) {
    NSString *extension=[NSString stringWithUTF8String:fileExtension];
    NSString *identifier=[NSString stringWithUTF8String:applicationID];
    dispatch_semaphore_t done=dispatch_semaphore_create(0);
    __block char *answer=NULL;
    dispatch_async(dispatch_get_main_queue(),^{ @autoreleasepool {
        UTType *type=mailType(extension); NSWorkspace *workspace=NSWorkspace.sharedWorkspace; NSURL *application=nil;
        if (changing) { answer=json(@{@"error":@"associationBusy"});dispatch_semaphore_signal(done);return; }
        if (!type) { answer=json(@{@"error":@"unsupportedAssociation"});dispatch_semaphore_signal(done);return; }
        NSString *key=[@"anser.previousMailApplication." stringByAppendingString:extension];
        NSUserDefaults *defaults=NSUserDefaults.standardUserDefaults;
        if ([identifier isEqualToString:@"self"]) {
            application=NSBundle.mainBundle.bundleURL;
            NSURL *current=[workspace URLForApplicationToOpenContentType:type];
            if (current && !sameApp(current,application) && appID(current).length) [defaults setObject:appID(current) forKey:key];
        } else if ([identifier isEqualToString:@"previous"]) {
            NSString *previous=[defaults stringForKey:key];
            if (!previous.length || [previous isEqualToString:NSBundle.mainBundle.bundleIdentifier]) { answer=json(@{@"error":@"associationNoPrevious"});dispatch_semaphore_signal(done);return; }
            for (NSURL *candidate in [workspace URLsForApplicationsToOpenContentType:type]) {
                if ([appID(candidate) isEqualToString:previous]) { application=candidate;break; }
            }
        }
        if (!application || ![application.pathExtension.lowercaseString isEqualToString:@"app"]) { answer=json(@{@"error":@"associationApplicationChanged"});dispatch_semaphore_signal(done);return; }
        changing=YES;
        [workspace setDefaultApplicationAtURL:application toOpenContentType:type completionHandler:^(NSError *error) {
            dispatch_async(dispatch_get_main_queue(),^{
                changing=NO;
                answer=json(error?@{@"error":@"associationDenied"}:@{});
                dispatch_semaphore_signal(done);
            });
        }];
    }});
    // A delayed OS consent response may still apply. Do not retry a mutation on
    // timeout. The UI refreshes actual state and disables changes while pending.
    if (dispatch_semaphore_wait(done,dispatch_time(DISPATCH_TIME_NOW,45*NSEC_PER_SEC))!=0) {
        // The completion owns its response after this return. Arrange deferred
        // cleanup once it signals, without touching the returned pending result.
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY,0),^{dispatch_semaphore_wait(done,DISPATCH_TIME_FOREVER);free(answer);});
        return json(@{@"error":@"associationPending"});
    }
    return answer;
}
void anser_mail_association_free(char *data) { free(data); }
