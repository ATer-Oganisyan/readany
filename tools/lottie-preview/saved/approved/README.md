# Approved animation

SVG and Lottie snapshots of the approved prototype. 320×320, two filled contours, eight Bézier anchors each. No opacity crossfade.

Play/pause and loader entry: 300 ms. Loader turn: 400 ms. Loader exit: 350 ms, spring frequency 17 rad/s, damping 0.465. Shape finishes before the first upright crossing.

Lottie markers identify forward, reverse, enter, settle, spin, exit and cancel. Coordinates and easing are baked into shape keyframes. Frame rate: 60; fractional keyframe times preserve timings.

For interactive playback use motion.json: loop spin while loading; when ready, exit at the next visually equivalent top/bottom alignment (phase .25 or .75). Use the exit marker for pause and cancel for play. The raw full timeline is a demonstration, not an audio-state controller.

The original app Lottie was not replaced.
