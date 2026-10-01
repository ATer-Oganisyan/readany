"""LLDB (Debug Simulator, after launch):
  command script import /absolute/path/to/scripts/verify_zoom_source.py
  narra-zoom-container-objc-check
  continue

Requires a stopped main thread after Expo has mounted the app. Only detached
views are created. Uses Expo's configured factory, never +new on the Swift view.
"""
import lldb

SOURCE = r'''
@import UIKit;
({
  NSString *(^check)(void) = ^NSString * {
    if (![NSThread isMainThread]) return @"FAIL: select the main thread";
    Class expo = (Class)NSClassFromString(@"ExpoFabricView");
    SEL contextSel = NSSelectorFromString(@"appContextFromClass");
    if (!expo || !(BOOL)[expo respondsToSelector:contextSel]) return @"FAIL: Expo runtime not initialized";
    id context = ((id (*)(id, SEL))(void *)[expo methodForSelector:contextSel])(expo, contextSel);
    if (!context) return @"FAIL: Expo has no current app context";
    SEL appIdSel = NSSelectorFromString(@"appIdentifier");
    if (!(BOOL)[context respondsToSelector:appIdSel]) return @"FAIL: no appIdentifier selector";
    NSString *appId = ((id (*)(id, SEL))(void *)[context methodForSelector:appIdSel])(context, appIdSel);
    NSString *className = @"ViewManagerAdapter_ReadAnyNativeControls_SystemSheetZoomSourceView";
    if (appId) className = [className stringByAppendingFormat:@"_%@", appId];
    SEL factorySel = NSSelectorFromString(@"makeViewClassForAppContext:moduleName:viewName:className:");
    if (!(BOOL)[expo respondsToSelector:factorySel]) return @"FAIL: Expo factory selector unavailable";
    Class flavor = ((Class (*)(id, SEL, id, id, id, id))(void *)[expo methodForSelector:factorySel])(
      expo, factorySel, context, @"ReadAnyNativeControls", @"SystemSheetZoomSourceView", className);
    if (!flavor) return @"FAIL: Expo factory returned nil";
    UIView *source = (UIView *)[flavor new];
    if (![NSStringFromClass((Class)[source class]) isEqualToString:@"ReadAnyNativeControls.SystemSheetZoomSourceView"])
      return @"FAIL: factory returned the wrong source class";
    if (source.subviews.count != 1) return @"FAIL: source does not contain exactly one native content wrapper";
    UIView *content = source.subviews.firstObject;
    if ([content class] != [UIView class]) return @"FAIL: zoom content must be a plain UIView";

    UIView *grid = (UIView *)[(id)[(Class)NSClassFromString(@"RCTViewComponentView") alloc] initWithFrame:CGRectZero];
    if (!grid) return @"FAIL: RCTViewComponentView is unavailable";
    SEL mountSel = NSSelectorFromString(@"mountChildComponentView:index:");
    SEL unmountSel = NSSelectorFromString(@"unmountChildComponentView:index:");
    typedef void (*ChildOperation)(id, SEL, UIView *, NSInteger);
    ChildOperation mountGrid = (ChildOperation)(void *)[grid methodForSelector:mountSel];
    ChildOperation unmountGrid = (ChildOperation)(void *)[grid methodForSelector:unmountSel];
    ChildOperation mountSource = (ChildOperation)(void *)[source methodForSelector:mountSel];
    ChildOperation unmountSource = (ChildOperation)(void *)[source methodForSelector:unmountSel];
    if (!mountGrid || !unmountGrid || !mountSource || !unmountSource)
      return @"FAIL: native mount/unmount selectors missing";
    UIView *left = [UIView new], *right = [UIView new], *first = [UIView new], *second = [UIView new];
    mountGrid(grid, mountSel, left, 0);
    mountGrid(grid, mountSel, source, 1);
    mountGrid(grid, mountSel, right, 2);
    mountSource(source, mountSel, first, 0);
    mountSource(source, mountSel, second, 1);
    if (first.superview != content || second.superview != content || content.subviews.count != 2)
      return @"FAIL: React children are not isolated inside native content";
    source.frame = (CGRect){{10, 20}, {120, 180}};
    [source layoutIfNeeded];
    if (content.frame.origin.x != 0 || content.frame.origin.y != 0 || content.frame.size.width != 120 || content.frame.size.height != 180)
      return @"FAIL: native content does not follow source bounds";

    UIView *placeholder = [UIView new], *transitionHost = [UIView new];
    [source insertSubview:placeholder belowSubview:content];
    [transitionHost addSubview:content];
    [source addSubview:content];
    if (grid.subviews.count != 3 || grid.subviews[0] != left || grid.subviews[1] != source || grid.subviews[2] != right)
      return @"FAIL: UIKit-style reparenting changed Fabric sibling indices";
    unmountSource(source, unmountSel, first, 0);
    if (first.superview || content.subviews.count != 1 || content.subviews[0] != second)
      return @"FAIL: child unmount removed the wrong view";
    unmountSource(source, unmountSel, second, 0);
    if (content.subviews.count) return @"FAIL: content children remain mounted";
    unmountGrid(grid, unmountSel, source, 1);
    if (grid.subviews.count != 2 || grid.subviews[0] != left || grid.subviews[1] != right)
      return @"FAIL: source unmount changed sibling order";
    return @"PASS: actual native source keeps UIKit reparenting inside wrapper; Fabric indices, layout and child unmount survive";
  };
  check();
})
'''


def check(debugger, command, result, internal_dict):
    process = debugger.GetSelectedTarget().GetProcess()
    if process.GetState() != lldb.eStateStopped:
        result.SetError("Stop the Debug app on its main thread first")
        return
    thread = process.GetSelectedThread()
    if thread.GetQueueName() != "com.apple.main-thread":
        result.SetError("Select the main thread first")
        return
    options = lldb.SBExpressionOptions()
    options.SetLanguage(lldb.eLanguageTypeObjC_plus_plus)
    options.SetTimeoutInMicroSeconds(30_000_000)
    options.SetIgnoreBreakpoints(True)
    value = thread.GetFrameAtIndex(0).EvaluateExpression(SOURCE, options)
    if value.GetError().Fail():
        result.SetError(value.GetError().GetCString())
        return
    summary = value.GetObjectDescription() or value.GetSummary() or str(value)
    if "PASS:" not in summary:
        result.SetError(summary)
        return
    result.PutCString(summary)


def __lldb_init_module(debugger, internal_dict):
    debugger.HandleCommand("command script add --overwrite -f " + __name__ + ".check narra-zoom-container-objc-check")
