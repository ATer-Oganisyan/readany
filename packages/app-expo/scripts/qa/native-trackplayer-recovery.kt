// Android/ReactHost ports only. Lifecycle method bodies are injected unchanged.
class Intent
class HeadlessJsTaskConfig
class ForegroundServiceStartNotAllowedException : RuntimeException()
class ReactContext { val tasks = HeadlessJsTaskContext() }
interface ReactInstanceEventListener { fun onReactContextInitialized(context: ReactContext) }
class ReactHost {
    var currentReactContext: ReactContext? = null
    var starts = 0
    val listeners = mutableListOf<ReactInstanceEventListener>()
    fun addReactInstanceEventListener(listener: ReactInstanceEventListener) { listeners.add(listener) }
    fun removeReactInstanceEventListener(listener: ReactInstanceEventListener) { listeners.remove(listener) }
    fun start() { starts++ }
}
class ReactApplication(val reactHost: ReactHost)
object UiThreadUtil {
    val queue = mutableListOf<() -> Unit>()
    fun runOnUiThread(task: () -> Unit) { queue.add(task) }
    fun flush() { while (queue.isNotEmpty()) queue.removeAt(0)() }
}
class HeadlessJsTaskContext {
    var starts = 0
    val listeners = mutableSetOf<Any>()
    fun addTaskEventListener(listener: Any) { listeners.add(listener) }
    fun removeTaskEventListener(listener: Any) { listeners.remove(listener) }
    fun startTask(config: HeadlessJsTaskConfig) { starts++ }
    companion object { fun getInstance(context: ReactContext) = context.tasks }
}
class Player { val items = mutableListOf<Int>(); var destroyed = false; fun destroy() { destroyed = true } }
class Job { fun cancel() {} }
open class HeadlessJsTaskService {
    val application: Any = ReactApplication(ReactHost())
    val stopped = mutableListOf<Int>()
    open fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = 0
    open fun onDestroy() {}
    fun stopSelf(startId: Int) { stopped.add(startId) }
    val START_STICKY = 1
    val START_NOT_STICKY = 2
}
class MusicService : HeadlessJsTaskService() {
    private lateinit var player: Player
    private var progressUpdateJob: Job? = null
    var promotions = 0
    var promotionError: RuntimeException? = null
    fun active() { player = Player(); player.items.add(1) }
    fun idle() { player = Player() }
    fun host() = (application as ReactApplication).reactHost
    fun getTaskConfig(intent: Intent?) = HeadlessJsTaskConfig()
    private fun currentReactContext(): ReactContext? = host().currentReactContext
    private fun startAndStopEmptyNotificationToAvoidANR() { promotions++; promotionError?.let { throw it } }
    // ACTUAL_FIELDS
    // ACTUAL_METHODS
}
fun main() {
    var failures = 0
    fun test(name: String, body: () -> Unit) {
        UiThreadUtil.queue.clear()
        try { body(); println("PASS $name") } catch (error: Throwable) { failures++; println("FAIL $name: $error") }
    }
    test("cold null restart does not resurrect JS or foreground") {
        val service = MusicService()
        check(service.onStartCommand(null, 0, 7) == 2)
        check(service.stopped == listOf(7)); check(service.promotions == 0); check(service.host().starts == 0)
    }
    test("initialized empty queue restart stops") {
        val service = MusicService(); service.idle()
        check(service.onStartCommand(null, 0, 8) == 2)
        check(service.promotions == 0); check(service.host().starts == 0)
    }
    test("active playback null intent preserves service and notification") {
        val service = MusicService(); service.active()
        check(service.onStartCommand(null, 0, 9) == 1)
        check(service.stopped.isEmpty()); check(service.promotions == 0); check(service.host().starts == 0)
    }
    test("normal foreground setup still starts headless task") {
        val service = MusicService(); val context = ReactContext(); service.host().currentReactContext = context
        check(service.onStartCommand(Intent(), 0, 10) == 1); UiThreadUtil.flush()
        check(service.promotions == 1); check(context.tasks.starts == 1)
    }
    test("destroy removes pending host listener and rejects late callback") {
        val service = MusicService(); service.onStartCommand(Intent(), 0, 11)
        val callback = service.host().listeners.single(); service.onDestroy()
        check(service.host().listeners.isEmpty())
        val context = ReactContext(); callback.onReactContextInitialized(context); UiThreadUtil.flush()
        check(context.tasks.starts == 0); check(context.tasks.listeners.isEmpty())
    }
    test("destroy before posted task prevents task and listener attachment") {
        val service = MusicService(); val context = ReactContext(); service.host().currentReactContext = context
        service.onStartCommand(Intent(), 0, 12); service.onDestroy(); UiThreadUtil.flush()
        check(context.tasks.starts == 0); check(context.tasks.listeners.isEmpty())
    }
    test("unrelated promotion exception is not hidden") {
        val service = MusicService(); val error = IllegalArgumentException("bad notification")
        service.promotionError = error
        val caught = runCatching { service.onStartCommand(Intent(), 0, 13) }.exceptionOrNull()
        check(caught === error)
    }
    test("replaced pending callback cannot start obsolete task") {
        val service = MusicService(); service.onStartCommand(Intent(), 0, 14)
        val obsolete = service.host().listeners.single()
        service.onStartCommand(Intent(), 0, 15)
        check(service.host().listeners.size == 1)
        val context = ReactContext(); obsolete.onReactContextInitialized(context); UiThreadUtil.flush()
        check(context.tasks.starts == 0)
        service.host().listeners.single().onReactContextInitialized(context); UiThreadUtil.flush()
        check(context.tasks.starts == 1)
    }
    test("destroy removes listener from originally used context after host replacement") {
        val service = MusicService(); val context = ReactContext(); service.host().currentReactContext = context
        service.onStartCommand(Intent(), 0, 16); UiThreadUtil.flush(); check(context.tasks.listeners.size == 1)
        service.host().currentReactContext = ReactContext(); service.onDestroy()
        check(context.tasks.listeners.isEmpty())
    }
    check(failures == 0) { "$failures Kotlin regressions failed" }
}
