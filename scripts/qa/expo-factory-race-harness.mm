// Foundation/ARC behavioral boundary. Real factory implementation is appended
// by the runner; only RN/Expo dependencies are controlled test doubles.
#import <Foundation/Foundation.h>
#include <atomic>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <thread>
#include <chrono>
#define TARGET_OS_OSX 0
static thread_local int owner = 0;
static bool overlap = true;
static std::mutex gate;
static std::condition_variable changed;
static bool secondCreated = false, firstFinished = false;
static std::atomic<bool> firstEntered{false};
static std::atomic<int> wrong{0}, alive{0};
static bool probeDealloc = false;
static __unsafe_unretained NSObject *publicationOwner = nil;
static std::atomic<int> lockBlocked{0}, pendingProbes{0};
namespace facebook { namespace jsi { struct Runtime { int id; }; }
namespace react {
struct RuntimeSchedulerBinding {
  static std::shared_ptr<RuntimeSchedulerBinding> getBinding(jsi::Runtime &runtime) {
    if (overlap) {
      std::unique_lock<std::mutex> lock(gate);
      if (runtime.id == 1) { firstEntered = true; changed.wait(lock, [] { return secondCreated; }); }
      else { secondCreated = true; changed.notify_all(); changed.wait(lock, [] { return firstFinished; }); }
    }
    return nullptr;
  }
  void *getRuntimeScheduler() { return nullptr; }
};
}}
namespace expo {
static void *createReactSchedulerHandle(void *) { return nullptr; }
static void dispatchOnReactScheduler() {}
}
@interface RCTHost : NSObject
@end
@implementation RCTHost
@end
@interface EXHostWrapper : NSObject
- (instancetype)initWithHost:(RCTHost *)host;
@end
@implementation EXHostWrapper
- (instancetype)initWithHost:(RCTHost *)host { return [super init]; }
@end
@interface EXAppContext : NSObject
@property int born;
- (void)setRuntime:(facebook::jsi::Runtime *)runtime scheduler:(void *)scheduler dispatch:(const void *)dispatch;
- (void)setHostWrapper:(EXHostWrapper *)wrapper;
- (void)registerNativeModules;
@end
@implementation EXAppContext
- (instancetype)init { if ((self = [super init])) { self.born = owner; alive++; } return self; }
- (void)dealloc {
  if (probeDealloc) {
    auto acquired = std::make_shared<std::atomic<bool>>(false);
    NSObject *target = publicationOwner;
    pendingProbes++;
    std::thread worker([target, acquired] {
      @synchronized (target) { acquired->store(true); }
      pendingProbes--;
    });
    auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(200);
    while (!acquired->load() && std::chrono::steady_clock::now() < deadline) std::this_thread::yield();
    if (!acquired->load()) { lockBlocked++; worker.detach(); }
    else worker.join();
  }
  alive--;
}
- (void)setRuntime:(facebook::jsi::Runtime *)runtime scheduler:(void *)scheduler dispatch:(const void *)dispatch {
  if (self.born != runtime->id) wrong++;
  // Deliberately no NativeState retention: models prepareRuntime failure.
}
- (void)setHostWrapper:(EXHostWrapper *)wrapper { if (self.born != owner) wrong++; }
- (void)registerNativeModules { if (self.born != owner) wrong++; }
@end
@interface EXReactNativeFactory : NSObject
- (void)host:(RCTHost *)host didInitializeRuntime:(facebook::jsi::Runtime &)runtime;
@end
// ACTUAL_FACTORY_IMPLEMENTATION
int main() {
  if (getenv("NARRA_FACTORY_DEALLOC_PROBE")) {
    overlap = false;
    @autoreleasepool {
      EXReactNativeFactory *factory = [EXReactNativeFactory new];
      publicationOwner = factory;
      owner = 1; facebook::jsi::Runtime first{1};
      [factory host:[RCTHost new] didInitializeRuntime:first];
      probeDealloc = true;
      owner = 2; facebook::jsi::Runtime second{2};
      [factory host:[RCTHost new] didInitializeRuntime:second];
      probeDealloc = false;
      while (pendingProbes.load()) std::this_thread::yield();
      if (alive != 1) return 9;
      publicationOwner = nil;
      factory = nil;
    }
    printf("destructor blocked on publication lock=%d\n", lockBlocked.load());
    return lockBlocked ? 10 : 0;
  }
  if (getenv("NARRA_FACTORY_STRESS")) {
    overlap = false;
    @autoreleasepool {
      EXReactNativeFactory *factory = [EXReactNativeFactory new];
      std::atomic<int> ready{0};
      auto work = [factory, &ready](int id) {
        owner = id;
        ready++;
        while (ready.load() != 2) std::this_thread::yield();
        for (int i = 0; i < 1000; i++) {
          @autoreleasepool {
            facebook::jsi::Runtime runtime{id};
            [factory host:[RCTHost new] didInitializeRuntime:runtime];
          }
        }
      };
      std::thread first(work, 1), second(work, 2);
      first.join(); second.join();
      if (alive != 1 || wrong != 0) return 7;
      factory = nil;
    }
    if (alive != 0) return 8;
    puts("2000 concurrent callbacks: isolated contexts, ownership, cleanup PASS");
    return 0;
  }
  @autoreleasepool {
    EXReactNativeFactory *factory = [EXReactNativeFactory new];
    std::thread first([factory] {
      @autoreleasepool {
        owner = 1; facebook::jsi::Runtime runtime{1};
        [factory host:[RCTHost new] didInitializeRuntime:runtime];
        { std::lock_guard<std::mutex> lock(gate); firstFinished = true; }
        changed.notify_all();
      }
    });
    // Wait until A created its context and is inside getBinding before starting B.
    while (!firstEntered.load()) std::this_thread::yield();
    std::thread second([factory] {
      @autoreleasepool {
        owner = 2; facebook::jsi::Runtime runtime{2};
        [factory host:[RCTHost new] didInitializeRuntime:runtime];
      }
    });
    first.join(); second.join();
    if (alive != 1) return 3; // Latest failed-init context remains factory-owned.
    factory = nil;
  }
  if (alive != 0) return 4;
  overlap = false;
  @autoreleasepool {
    EXReactNativeFactory *factory = [EXReactNativeFactory new];
    owner = 3; facebook::jsi::Runtime runtime{3};
    [factory host:[RCTHost new] didInitializeRuntime:runtime];
    if (alive != 1) return 5; // Failed preparation must not destroy it on return.
    factory = nil;
  }
  if (alive != 0) return 6;
  printf("cross-context calls=%d; failed-init ownership and final cleanup PASS\n", wrong.load());
  return wrong ? 2 : 0;
}
