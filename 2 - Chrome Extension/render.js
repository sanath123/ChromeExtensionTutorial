//  dimension constraint globals for TFJS rendering
var tfjs_720p = {"height":{"max":720,"min":1}, "width":{"max":1280,"min":1}}
var tfjs_360p = {"height":{"max":360,"min":1}, "width":{"max":480,"min":1}}
var tfjs_240p = {"height":{"max":240,"min":1}, "width":{"max":352,"min":1}}

console.log("IN RENDER ALT.js")
/**
 * global parameters.
 */
let Animator = {
    imageCapture: null,
    original_stream: null,
    canvas_stream: null,
    net: null,
    tfjs_draw_counter: 0,
    video_on: false,
    draw_type: "tfjs-pixel",    //  This should have a function defined that's called in get_canvas_stream that reads from the Extension's persistent data,
                                //  which the user updates/selects.
                                //  Current supported values : "grayscale", "tfjs-pixel", "blur", "sepia"
    limit_tfjs: tfjs_240p,
    logging: false,
    log: (message) => {
        if(Animator.logging)
            console.log('Animator:', message);
    },  
 }

/**
 * enable the console logging.
 */
Animator.logging = true;


function utils_json_res(constraints, fallback_constraints)
{
    var width_patt = /width\"*:\{*[(\"max\")|(\"min\")|(\"exact\")]*:*(\d+)/g
    var height_patt = /height\"*:\{*[(\"max\")|(\"min\")|(\"exact\")]*:*(\d+)/g
    var json_string = JSON.stringify(constraints)

    try
    {
        var max_height=0
        json_string.match(height_patt).forEach((element) => {
        var res = parseInt(element.match(/(\d+)/g))
        if (res>max_height)
            max_height=res	
        });

        var max_width=0
        json_string.match(width_patt).forEach((element) => {
        var res = parseInt(element.match(/(\d+)/g))
        if (res>max_width)
            max_width=res	
        });

        //  console.log("Status by match ", max_width, max_height)
        if(max_height==0 || max_width==0)
        {
            max_height = fallback_constraints.height.max
            max_width = fallback_constraints.width.max
        }
    }
    catch(error)
    { 
        console.log("utils error", error)
    }

    return [ max_width, max_height ]
}

function add_dynamic_elements(constraints, fallback_constraints)
{
    /*  
        Primary canvas that serves as the source of the modified stream which is passed onto the getUserMedia API.
        Resolution needs to be what the User's device supports.
        Check constraints.txt for sample JSON.
    */
    var dims = utils_json_res(constraints, fallback_constraints)
    console.log("Returned dims:", dims)
    var invisible_canvas = document.createElement('CANVAS')
    invisible_canvas.id = "invisible"
    invisible_canvas.height = dims[1]
    invisible_canvas.width = dims[0]
    invisible_canvas.style.position= "absolute"
    invisible_canvas.style.right = -dims[0]

    //  Div that keeps the content out of the viewport, disables overflow so no scrollbars!
    var wrap_div = document.createElement("div")
    wrap_div.id = "wrap_div"
    wrap_div.style.position= "relative"
    wrap_div.style.right = "0"
    wrap_div.style.bottom = "0px"
    wrap_div.style.width= "0"
    wrap_div.style.height= "0"
    wrap_div.style.overflow= "hidden"

    /*  
        A VideoElement needed to render the imageFrames that goes into the TFJS module. We can't use the first canvas as that is the 
        one that generates the stream.
        Resolution needs to be what the User's device supports.
        Using it for all cases as drawing from VideoElement is far more stable than grabFrame() from stream directly.
    */
    var invisible_video = document.createElement('video')
    invisible_video.id = "invisible_video"
    invisible_video.height = dims[1]
    invisible_video.width = dims[0]
    invisible_video.style.position= "absolute"
    invisible_video.style.right = (2 * dims[0])

    //  If TFJS renders, Limit Video to tfjs supported constraints
    //  We will upscale from the extra canvas here before returning to primary canvas
    if(Animator.draw_type==="tfjs-pixel")
    {
        invisible_video.height = Animator.limit_tfjs.height.max
        invisible_video.width = Animator.limit_tfjs.width.max
        invisible_video.style.right = (2 * Animator.limit_tfjs.width.max)

        // Add a tertiary canvas which draws the capped res img, use it as feed onto primary canvas
        var tfjs_feed = document.createElement('CANVAS')
        tfjs_feed.id = "tfjs_feed"
        tfjs_feed.height = Animator.limit_tfjs.height.max
        tfjs_feed.width = Animator.limit_tfjs.width.max
        tfjs_feed.style.position= "absolute"
        tfjs_feed.style.right = (4 * Animator.limit_tfjs.width.max)
        wrap_div.appendChild(tfjs_feed)
    }
    
    //  Append all dynamics to the Div
    wrap_div.appendChild(invisible_canvas)
    wrap_div.appendChild(invisible_video)

    //  Finally append the Div
    document.body.appendChild(wrap_div)
    console.log("Added Div")
}

function remove_dynamic_elements()
{
    var dyn = document.getElementById("wrap_div")
    if(dyn)
    {
        document.body.removeChild(dyn)
    }
}

function override_getUserMedia()
{
    console.log("Overriding")
    let originalMediaDevicesGetUserMedia = navigator.mediaDevices.getUserMedia;
    console.log("can access navigator")
    navigator.mediaDevices.getUserMedia = function getUserMedia(constraints) { 
    return new Promise((resolve, reject) => {
        console.log("Original Requested Constraints:\n" , JSON.stringify(constraints))
        originalMediaDevicesGetUserMedia.bind(navigator.mediaDevices)(constraints)
        .then(stream => resolve(get_canvas_stream_beta(stream, constraints)))    //  this is where we'd divert the stream to a call that modifies it, before resolving the promise
        .catch(reject)
    });
    }
    console.log("success override")
}

function get_canvas_stream_beta(stream, constraints)
{   
    var stream_new;
    console.log("in stream handover")
    if(constraints.video)
    {   
        //  Check if it's a screen share!
        if( JSON.stringify(constraints).indexOf("chromeMediaSource") > -1 ) {
            console.log("Returning Screenshare");
            return stream
        }

        //  Previous states/track cleanup if any.
        Animator.video_on = false
        if (Animator.canvas_stream!=null)
            Animator.canvas_stream.getVideoTracks()[0].stop()
        if (Animator.original_stream!=null)
            Animator.original_stream.getVideoTracks()[0].stop()

        Animator.original_stream = stream
        var original_constraints = stream.getVideoTracks()[0].getCapabilities()
        console.log("ORIG VIDEO META:", JSON.stringify(original_constraints))


        //  Adapt the canvas to new contraints, remove previous artifacts
        remove_dynamic_elements()

        Animator.tfjs_draw_counter = 0
        add_dynamic_elements(constraints, original_constraints)

        var video = document.getElementById("invisible_video")

        var canvas = document.getElementById("invisible")
        stream_new = canvas.captureStream(30)
        Animator.canvas_stream = stream_new  //  Maintain global ref. to the stream

        video.srcObject = stream
        video.play()

        //  log new stream's constraints
        console.log("NEW VIDEO META:", 
                        JSON.stringify(stream_new.getVideoTracks()[0].getCapabilities()))

        if(constraints.audio)
        {
            stream_new.addTrack(stream.getAudioTracks()[0]);
            console.log("AUDIO META:", 
                            JSON.stringify(stream_new.getAudioTracks()[0].getCapabilities()))
        }
        Animator.video_on = true; // audioTimer's loop condition.
        audioTimerLoop(nextVideoFrame, 60)
        //  nextVideoFrame()
        console.log("returning a stream")
        return stream_new
    }
    else if (constraints.audio)
    {   
        //  only audio, just let the original stream be as is.
        console.log("Audio Only")
        console.log("AUDIO META:", 
                        JSON.stringify(stream.getAudioTracks()[0].getCapabilities()))
        return stream
    }

    console.log("Default return")
    return stream;
}



/*
    Root function for drawing each frame, passed as callback to the AudioTimer.
    Not using requestAnimationFrame() callback as that gets suspended on tab switch/minimize, can't have that on a live video stream.
*/

function nextVideoFrame()
{
    /*
        Since we have 2 streams running, and only the canvas stream goes to the app... Only the canvas stream
        will have its' tracks' stop() called when we stop video on the app.
        We have to call the original stream's stop on the video track manually! 
        Otherwise the Camera will still remain active!
    */
    var video = document.getElementById("invisible_video")
    var canvas_track = Animator.canvas_stream.getVideoTracks()[0]

    if(canvas_track.readyState != 'live')
    {
        Animator.original_stream.getVideoTracks()[0].stop()
        Animator.video_on = false
        console.log("Video Stopped")
        remove_dynamic_elements()
        return
    }

    var canvas = document.getElementById("invisible")
    drawCanvas(canvas, video, Animator.draw_type)  
}

/*
    Base function for standard 2D filters.
    The drawtype should ideally be fetched from extension config, controlled/edited by the user.
    Should be switchable on the fly!
*/
function drawCanvas(canvas, img, draw_type) 
{
    switch(draw_type)
    {
        case "grayscale":
            canvas.getContext('2d').filter="grayscale(50)"
            canvas.getContext('2d').drawImage(img, 0, 0)
            break

        case "blur":
            canvas.getContext('2d').filter="blur(40px)"
            canvas.getContext('2d').drawImage(img, 0, 0)
            break

        case "sepia":
            canvas.getContext('2d').filter="sepia(50)"
            canvas.getContext('2d').drawImage(img, 0, 0)
            break

        case "tfjs-pixel":
            console.log("drawing tfjs" , Animator.tfjs_draw_counter)
            Animator.tfjs_draw_counter++
            //  Draw first to feed canvas
            var feed = document.getElementById("tfjs_feed")
            tensor_draw_pixel(feed, img)

            //  Scale and draw to primary canvas
            scale_draw(canvas, feed)
            break
    }
}

/*
    TODO: Base function for TFJS based draws.
    Should handle BodyPix variations (Overlay/Pixels) and Pose-Animator.
*/
async function tensor_draw_pixel(canvas, img)
{
    try
    {   
        if (Animator.tfjs_draw_counter==300)
            throw ReferenceError
        const partSegmentation = await Animator.net.segmentMultiPersonParts(img);

        // The colored part image is an rgb image with a corresponding color from the
        // rainbow colors for each part at each pixel, and black pixels where there is
        // no part.
        const coloredPartImage = bodyPix.toColoredPartMask(partSegmentation);
        const opacity = 1;
        const flipHorizontal = false;
        const maskBlurAmount = 0;
        // Draw the colored part image on top of the original image onto a canvas.
        bodyPix.drawPixelatedMask(
            canvas, img, coloredPartImage, opacity, maskBlurAmount,
            flipHorizontal);
    }
    catch(error)
    {   
        Animator.tfjs_draw_counter  = 0
        // Should be filling with a black/gray rect entirely, to keep User anonymous...
        console.log(error)
        canvas.getContext('2d').fillRect(0,0, canvas.width, canvas.height)
    }
}

function scale_draw(canvas, img)
{
    let ratio  = Math.min(canvas.width / img.width, canvas.height / img.height);
    let x = (canvas.width - img.width * ratio) / 2;
    let y = (canvas.height - img.height * ratio) / 2;
    canvas.getContext('2d').drawImage(img, 0, 0, img.width, img.height,
        x, y, img.width * ratio, img.height * ratio);
}

loadPix()
override_getUserMedia()

async function loadPix()
{
    //   net = await bodyPix.load();
    Animator.net = await bodyPix.load({
    architecture: 'MobileNetV1',
    outputStride: 16,
    multiplier: 1,
    quantBytes: 2,
    internalResolution: 'high'
    });
    console.log("Loaded BodyPix!")
    
}

/*
    An alternative timing loop, based on AudioContext's clock
    @arg callback : a callback function with the audioContext's currentTime passed as unique argument
    @arg frequency : float in ms;
*/
function audioTimerLoop(callback, frequency) 
{
    var freq = frequency/1000   //  AudioContext time parameters are in seconds
    var aCtx = new AudioContext()
    //  Chrome needs our oscillator node to be attached to the destination
    //  So we create a silent Gain Node
    var silence = aCtx.createGain()
    silence.gain.value = 0
    silence.connect(aCtx.destination)

    onOSCend();

    function onOSCend() 
    {
        var osc = aCtx.createOscillator()
        osc.onended = onOSCend  //  so we can loop
        osc.connect(silence)
        osc.start(0)    //  start it now
        //  console.log("In Timer loop")
        osc.stop(aCtx.currentTime + freq)   //  stop it next frame
        callback(aCtx.currentTime)  //  one frame is done

        if (!Animator.video_on) {    //  user broke the loop
            osc.onended = function() {
            aCtx.close();   //  clear the audioContext
            console.log("Exiting Timer loop", video_on)
            return
            };
        }
    };
}