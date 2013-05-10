/*jslint undef: true, nomen: true, eqeqeq: true, plusplus: true, newcap: true, immed: true, browser: true, devel: true, passfail: false */
/*global window: false, readConvertLinksToFootnotes: false, readStyle: false, readSize: false, readMargin: false, Typekit: false, ActiveXObject: false */

var moment = require('moment');

var dateish = require('dateish');

// var dateish  = require('dateish');

var dbg = (typeof console !== 'undefined') ? function(s) {
    if (readability.debugging) {
        console.log("Readability: ", s);
    }
} : function() {};

var log = function() {
  // if (readability.logging)
    console.log.apply(console, arguments); //("R: ", o);
}

/*
 * Readability. An Arc90 Lab Experiment. 
 * Website: http://lab.arc90.com/experiments/readability
 * Source:  http://code.google.com/p/arc90labs-readability
 *
 * "Readability" is a trademark of Arc90 Inc and may not be used without explicit permission. 
 *
 * Copyright (c) 2010 Arc90 Inc
 * Readability is licensed under the Apache License, Version 2.0.
**/
var readability = {
    version:                '1.7.1',
    debugging:              true,
    emailSrc:               'http://lab.arc90.com/experiments/readability/email.php',
    iframeLoads:             0,
    convertLinksToFootnotes: false,
    reversePageScroll:       false, /* If they hold shift and hit space, scroll up */
    frameHack:               false, /**
                                      * The frame hack is to workaround a firefox bug where if you
                                      * pull content out of a frame and stick it into the parent element, the scrollbar won't appear.
                                      * So we fake a scrollbar in the wrapping div.
                                     **/
    biggestFrame:            false,
    bodyCache:               null,   /* Cache the body HTML in case we need to re-use it later */
    flags:                   0x1 | 0x2 | 0x4,   /* Start with all flags set. */

    /* constants */
    FLAG_STRIP_UNLIKELYS:     0x1,
    FLAG_WEIGHT_CLASSES:      0x2,
    FLAG_CLEAN_CONDITIONALLY: 0x4,

    maxPages:    30, /* The maximum number of pages to loop through before we call it quits and just show a link. */
    parsedPages: {}, /* The list of pages we've parsed in this call of readability, for autopaging. As a key store for easier searching. */
    pageETags:   {}, /* A list of the ETag headers of pages we've parsed, in case they happen to match, we'll know it's a duplicate. */
    
    /**
     * All of the regular expressions in use within readability.
     * Defined up here so we don't instantiate them repeatedly in loops.
     **/
    regexps: {
        unlikelyCandidates:    /combx|comment|community|disqus|extra|foot|header|menu|remark|rss|shoutbox|sidebar|sponsor|ad-break|agegate|pagination|pager|popup|tweet|twitter/i,
        okMaybeItsACandidate:  /and|article|body|column|main|shadow/i,
        positive:              /article|body|content|entry|hentry|main|page|pagination|post|text|blog|story/i,
        negative:              /combx|comment|com-|contact|foot|footer|footnote|masthead|media|meta|outbrain|promo|related|scroll|shoutbox|sidebar|sponsor|shopping|tags|tool|widget/i,
        extraneous:            /print|archive|comment|discuss|e[\-]?mail|share|reply|all|login|sign|single/i,
        divToPElements:        /<(a|blockquote|dl|div|img|ol|p|pre|table|ul)/i,
        replaceBrs:            /(<br[^>]*>[ \n\r\t]*){2,}/gi,
        replaceFonts:          /<(\/?)font[^>]*>/gi,
        trim:                  /^\s+|\s+$/g,
        normalize:             /\s{2,}/g,
        killBreaks:            /(<br\s*\/?>(\s|&nbsp;?)*){1,}/g,
        videos:                /http:\/\/(www\.)?(youtube|vimeo)\.com/i,
        skipFootnoteLink:      /^\s*(\[?[a-z0-9]{1,2}\]?|^|edit|citation needed)\s*$/i,
        nextLink:              /(next|weiter|continue|>([^\|]|$)|»([^\|]|$))/i, // Match: next, continue, >, >>, » but not >|, »| as those usually mean last.
        prevLink:              /(prev|earl|old|new|<|«)/i
    },

    /**
     * Runs readability.
     * 
     * Workflow:
     *  1. Prep the document by removing script tags, css, etc.
     *  2. Build readability's DOM tree.
     *  3. Grab the article content from the current dom tree.
     *  4. Replace the current DOM tree with the new one.
     *  5. Read peacefully.
     *
     * @return void
     **/
    init: function() {
        /* Before we do anything, remove all scripts that are not readability. */
        window.onload = window.onunload = function() {};

        // readability.removeScripts(document);
        // readability.removeStyles(document);

        if(document.body && !readability.bodyCache) {
            readability.bodyCache = document.body.innerHTML;

        }
        /* Make sure this document is added to the list of parsed pages first, so we don't double up on the first page */
        readability.parsedPages[window.location.href.replace(/\/$/, '')] = true;

        /* Pull out any possible next page link first */
        var nextPageLink = readability.findNextPageLink(document.body);
        
        readability.prepDocument();

        /* Build readability's DOM tree */
        var overlay        = document.createElement("DIV");
        var innerDiv       = document.createElement("DIV");
        var articleContent = readability.grabArticle();

        if (!articleContent) {
            articleContent = document.createElement("DIV");
            articleContent.id = "content";
        }

        // overlay.id              = "container";
        
        // overlay.appendChild( articleContent );

        /* Clear the old HTML, insert the new content. */
        document.body.innerHTML = "";
        document.body.insertBefore(articleContent, document.body.firstChild);
        document.body.removeAttribute('style');



        /**
         * If someone tries to use Readability on a site's root page, give them a warning about usage.
        **/
        if((window.location.protocol + "//" + window.location.host + "/") === window.location.href)
        {
            articleContent.style.display = "none";
            var rootWarning = document.createElement('p');
                rootWarning.id = "readability-warning";
                rootWarning.innerHTML = "<em>Readability</em> was intended for use on individual articles and not home pages. " +
                    "If you'd like to try rendering this page anyway, <a onClick='javascript:document.getElementById(\"readability-warning\").style.display=\"none\";document.getElementById(\"content\").style.display=\"block\";'>click here</a> to continue.";

            innerDiv.insertBefore( rootWarning, articleContent );
        }



        if (nextPageLink) {
            readability.appendNextPage(nextPageLink);
        }

    },

    /**
     * Run any post-process modifications to article content as necessary.
     * 
     * @param Element
     * @return void
    **/
    postProcessContent: function(articleContent) {},

    /**
     * Some content ends up looking ugly if the image is too large to be floated.
     * If the image is wider than a threshold (currently 55%), no longer float it,
     * center it instead.
     *
     * @param Element
     * @return void
    **/
    fixImageFloats: function (articleContent) {},

    /**
     * Get the article tools Element that has buttons like reload, print, email.
     *
     * @return void
     **/
    getArticleTools: function () {
        var articleTools = document.createElement("DIV");
        return articleTools;
    },

    /**
     * retuns the suggested direction of the string
     *
     * @return "rtl" || "ltr"
     **/
    getSuggestedDirection: function(text) {return "ltr"; },

    
    /**
     * Get the article title as an H1.
     *
     * @return void
     **/
    getArticleTitle: function () {
        var curTitle = "",
            origTitle = "";

        try {
            curTitle = origTitle = document.title;
            
            if(typeof curTitle !== "string") { /* If they had an element with id "title" in their HTML */
                curTitle = origTitle = readability.getInnerText(document.getElementsByTagName('title')[0]);             
            }
        }
        catch(e) {}
        
        if(curTitle.match(/ [\|\-] /))
        {
            curTitle = origTitle.replace(/(.*)[\|\-] .*/gi,'$1');
            
            if(curTitle.split(' ').length < 3) {
                curTitle = origTitle.replace(/[^\|\-]*[\|\-](.*)/gi,'$1');
            }
        }
        else if(curTitle.indexOf(': ') !== -1)
        {
            curTitle = origTitle.replace(/.*:(.*)/gi, '$1');

            if(curTitle.split(' ').length < 3) {
                curTitle = origTitle.replace(/[^:]*[:](.*)/gi,'$1');
            }
        }
        else if(curTitle.length > 150 || curTitle.length < 15)
        {
            var hOnes = document.getElementsByTagName('h1');
            if(hOnes.length === 1)
            {
                curTitle = readability.getInnerText(hOnes[0]);
            }
        }

        curTitle = curTitle.replace( readability.regexps.trim, "" );

        if(curTitle.split(' ').length <= 4) {
            curTitle = origTitle;
        }
        
        var articleTitle = document.createElement("H1");
        articleTitle.innerHTML = curTitle;
        
        return articleTitle;
    },

    /**
     * Get the footer with the readability mark etc.
     *
     * @return void
     **/
    getArticleFooter: function () {
        var articleFooter = document.createElement("DIV");
        return articleFooter;
    },
    
    /**
     * Prepare the HTML document for readability to scrape it.
     * This includes things like stripping javascript, CSS, and handling terrible markup.
     * 
     * @return void
     **/
    prepDocument: function () {
        /**
         * In some cases a body element can't be found (if the HTML is totally hosed for example)
         * so we create a new body node and append it to the document.
         */
        if(document.body === null)
        {
            var body = document.createElement("body");
            try {
                document.body = body;       
            }
            catch(e) {
                document.documentElement.appendChild(body);
                dbg(e);
            }
        }

        document.body.id = "readabilityBody";

        var frames = document.getElementsByTagName('frame');
        if(frames.length > 0)
        {
            var bestFrame = null;
            var bestFrameSize = 0;    /* The frame to try to run readability upon. Must be on same domain. */
            var biggestFrameSize = 0; /* Used for the error message. Can be on any domain. */
            for(var frameIndex = 0; frameIndex < frames.length; frameIndex+=1)
            {
                var frameSize = frames[frameIndex].offsetWidth + frames[frameIndex].offsetHeight;
                var canAccessFrame = false;
                try {
                    var frameBody = frames[frameIndex].contentWindow.document.body;
                    canAccessFrame = true;
                }
                catch(eFrames) {
                    dbg(eFrames);
                }

                if(frameSize > biggestFrameSize) {
                    biggestFrameSize         = frameSize;
                    readability.biggestFrame = frames[frameIndex];
                }
                
                if(canAccessFrame && frameSize > bestFrameSize)
                {
                    readability.frameHack = true;
    
                    bestFrame = frames[frameIndex];
                    bestFrameSize = frameSize;
                }
            }

            if(bestFrame)
            {
                var newBody = document.createElement('body');
                newBody.innerHTML = bestFrame.contentWindow.document.body.innerHTML;
                newBody.style.overflow = 'scroll';
                document.body = newBody;
                
                var frameset = document.getElementsByTagName('frameset')[0];
                if(frameset) {
                    frameset.parentNode.removeChild(frameset); }
            }
        }

    },

    /**
     * For easier reading, convert this document to have footnotes at the bottom rather than inline links.
     * @see http://www.roughtype.com/archives/2010/05/experiments_in.php
     *
     * @return void
    **/
    addFootnotes: function(articleContent) {},

    useRdbTypekit: function () {},

    /**
     * Prepare the article node for display. Clean out any inline styles,
     * iframes, forms, strip extraneous <p> tags, etc.
     *
     * @param Element
     * @return void
     **/
    prepArticle: function (articleContent) {
        readability.cleanStyles(articleContent);
        readability.killBreaks(articleContent);

        /* Clean out junk from the article content */
        readability.cleanConditionally(articleContent, "form");
        readability.clean(articleContent, "object");
        readability.clean(articleContent, "h1");

        /**
         * If there is only one h2, they are probably using it
         * as a header and not a subheader, so remove it since we already have a header.
        ***/
        if(articleContent.getElementsByTagName('h2').length === 1) {
            readability.clean(articleContent, "h2");
        }
        readability.clean(articleContent, "iframe");

        readability.cleanHeaders(articleContent);

        /* Do these last as the previous stuff may have removed junk that will affect these */
        readability.cleanConditionally(articleContent, "table");
        readability.cleanConditionally(articleContent, "ul");
        readability.cleanConditionally(articleContent, "div");

timed(function() {
        /* Remove extra paragraphs */
        //arrix
        function WalkChildrenElements(node, func) {
            function walk(cur) {
                var children = cur.children, i, len, e;
                for (i = 0, len = children.length; i < len; i++) {
                    e = children[i];
                    if (e.nodeType == 1) {
                        func(e);
                        walk(e);
                    }
                }
            }
            walk(node);
        }

        var articleParagraphs = articleContent.getElementsByTagName('p');
        for(var i = articleParagraphs.length-1; i >= 0; i-=1) {
            var imgCount    = 0; //articleParagraphs[i].getElementsByTagName('img').length;
            var embedCount  = 0; // articleParagraphs[i].getElementsByTagName('embed').length;
            var objectCount = 0; // articleParagraphs[i].getElementsByTagName('object').length;

            //arrix
            WalkChildrenElements(articleParagraphs[i], function(cur) {
                switch (cur.tagName) {
                    case 'IMG':
                    imgCount++;
                    break;
                    case 'EMBED':
                    embedCount++;
                    break;
                    case 'OBJECT':
                    objectCount++;
                    break;
                }
            
            });

            if(imgCount === 0 && embedCount === 0 && objectCount === 0 && readability.getInnerText(articleParagraphs[i], false) === '') {
                articleParagraphs[i].parentNode.removeChild(articleParagraphs[i]);
            }
        }
}, "prepArticle Remove extra paragraphs");

timed(function() {
        try {
            articleContent.innerHTML = articleContent.innerHTML.replace(/<br[^>]*>\s*<p/gi, '<p');      
        }
        catch (e) {
            dbg("Cleaning innerHTML of breaks failed. This is an IE strict-block-elements bug. Ignoring.: " + e);
        }
}, "prepArticle innerHTML replacement");
    },
    
    /**
     * Initialize a node with the readability object. Also checks the
     * className/id for special names to add to its score.
     *
     * @param Element
     * @return void
    **/
    initializeNode: function (node) {
        node.readability = {"contentScore": 0};         

        switch(node.tagName) {
            case 'DIV':
                node.readability.contentScore += 5;
                break;

            case 'PRE':
            case 'TD':
            case 'BLOCKQUOTE':
                node.readability.contentScore += 3;
                break;
                
            case 'ADDRESS':
            case 'OL':
            case 'UL':
            case 'DL':
            case 'DD':
            case 'DT':
            case 'LI':
            case 'FORM':
                node.readability.contentScore -= 3;
                break;

            case 'H1':
            case 'H2':
            case 'H3':
            case 'H4':
            case 'H5':
            case 'H6':
            case 'TH':
                node.readability.contentScore -= 5;
                break;
        }
       
        node.readability.contentScore += readability.getClassWeight(node);
    },
    
    /***
     * grabArticle - Using a variety of metrics (content score, classname, element types), find the content that is
     *               most likely to be the stuff a user wants to read. Then return it wrapped up in a div.
     *
     * @param page a document to run upon. Needs to be a full document, complete with body.
     * @return Element
    **/
    grabArticle: function (page) {
        var stripUnlikelyCandidates = readability.flagIsActive(readability.FLAG_STRIP_UNLIKELYS),
            isPaging = (page !== null) ? true: false;

        page = page ? page : document.body;

        var pageCacheHtml = page.innerHTML;

        /**
         * First, node prepping. Trash nodes that look cruddy (like ones with the class name "comment", etc), and turn divs
         * into P tags where they have been used inappropriately (as in, where they contain no other block level elements.)
         *
         * Note: Assignment from index for performance. See http://www.peachpit.com/articles/article.aspx?p=31567&seqNum=5
         * TODO: Shouldn't this be a reverse traversal?
        **/
        var nodesToScore = [];
        function nodePrepping(node) {
            /* Remove unlikely candidates */
            if (stripUnlikelyCandidates) {
                var unlikelyMatchString = node.className + node.id;
                if (
                    (
                        unlikelyMatchString.search(readability.regexps.unlikelyCandidates) !== -1 &&
                        unlikelyMatchString.search(readability.regexps.okMaybeItsACandidate) === -1 &&
                        node.tagName !== "BODY"
                    )
                )
                {
                    dbg("Removing unlikely candidate - " + unlikelyMatchString);
                    node.parentNode.removeChild(node);
                    return null;
                }               
            }

            if (node.tagName === "P" || node.tagName === "TD" || node.tagName === "PRE") {
                nodesToScore[nodesToScore.length] = node;
            }

            /* Turn all divs that don't have children block level elements into p's */
            if (node.tagName === "DIV") {
                if (node.innerHTML.search(readability.regexps.divToPElements) === -1) {
                    var newNode = document.createElement('p');
                    try {
                        newNode.innerHTML = node.innerHTML;             
                        node.parentNode.replaceChild(newNode, node);

                        nodesToScore[nodesToScore.length] = node;

                        newNode.oneMoreTime = true;
                        return newNode;
                    }
                    catch(e) {
                        dbg("Could not alter div to p, probably an IE restriction, reverting back to div.: " + e);
                    }
                }
                else
                {
                    /* EXPERIMENTAL */
                    for(var i = 0, il = node.childNodes.length; i < il; i+=1) {
                        var childNode = node.childNodes[i];
                        if(childNode.nodeType === 3) { // Node.TEXT_NODE
                            var p = document.createElement('p');
                            p.innerHTML = childNode.nodeValue;
                            p.style.display = 'inline';
                            p.className = 'readability-styled';
                            childNode.parentNode.replaceChild(p, childNode);
                        }
                    }
                }
            }
            return node;
        }

        timed(function() {
            LiveTagWalker(page, '*', nodePrepping);
        }, 'grabArticle nodePrepping');

        /**
         * Loop through all paragraphs, and assign a score to them based on how content-y they look.
         * Then add their score to their parent node.
         *
         * A score is determined by things like number of commas, class names, etc. Maybe eventually link density.
        **/
        var candidates = [];
timed(function() {
        for (var pt=0; pt < nodesToScore.length; pt+=1) {
            var parentNode      = nodesToScore[pt].parentNode;
            var grandParentNode = parentNode ? parentNode.parentNode : null;
            var innerText       = readability.getInnerText(nodesToScore[pt]);

            if(!parentNode || typeof(parentNode.tagName) === 'undefined') {
                continue;
            }

            /* If this paragraph is less than 25 characters, don't even count it. */
            if(innerText.length < 25) {
                continue; }

            /* Initialize readability data for the parent. */
            if(typeof parentNode.readability === 'undefined') {
                readability.initializeNode(parentNode);
                candidates.push(parentNode);
            }

            /* Initialize readability data for the grandparent. */
            if(grandParentNode && typeof(grandParentNode.readability) === 'undefined' && typeof(grandParentNode.tagName) !== 'undefined') {
                readability.initializeNode(grandParentNode);
                candidates.push(grandParentNode);
            }

            var contentScore = 0;

            /* Add a point for the paragraph itself as a base. */
            contentScore+=1;

            /* Add points for any commas within this paragraph */
            contentScore += innerText.split(readability.reComma).length; //arrix
            
            /* For every 100 characters in this paragraph, add another point. Up to 3 points. */
            contentScore += Math.min(Math.floor(innerText.length / 100), 3);
            
            /* Add the score to the parent. The grandparent gets half. */
            parentNode.readability.contentScore += contentScore;

            if(grandParentNode) {
                grandParentNode.readability.contentScore += contentScore/2;             
            }
        }

}, 'grabArticle calculate scores');

        /**
         * After we've calculated scores, loop through all of the possible candidate nodes we found
         * and find the one with the highest score.
        **/
        var topCandidate = null;
timed(function() {
        for(var c=0, cl=candidates.length; c < cl; c+=1)
        {
            /**
             * Scale the final candidates score based on link density. Good content should have a
             * relatively small link density (5% or less) and be mostly unaffected by this operation.
            **/
            candidates[c].readability.contentScore = candidates[c].readability.contentScore * (1-readability.getLinkDensity(candidates[c]));

            dbg('Candidate: ' + candidates[c] + " (" + candidates[c].className + ":" + candidates[c].id + ") with score " + candidates[c].readability.contentScore);

            if(!topCandidate || candidates[c].readability.contentScore > topCandidate.readability.contentScore) {
                topCandidate = candidates[c]; }
        }

        /**
         * If we still have no top candidate, just use the body as a last resort.
         * We also have to copy the body node so it is something we can modify.
         **/
        if (topCandidate === null || topCandidate.tagName === "BODY")
        {
            topCandidate = document.createElement("DIV");
            topCandidate.innerHTML = page.innerHTML;
            page.innerHTML = "";
            page.appendChild(topCandidate);
            readability.initializeNode(topCandidate);
        }
}, 'grabArticle find top candidate');

        /**
         * Now that we have the top candidate, look through its siblings for content that might also be related.
         * Things like preambles, content split by ads that we removed, etc.
        **/
        var articleContent        = document.createElement("DIV");

timed(function(){
        if (isPaging) {
            articleContent.id     = "content";
        }
        var siblingScoreThreshold = Math.max(10, topCandidate.readability.contentScore * 0.2);
        var siblingNodes          = topCandidate.parentNode.childNodes;


        for(var s=0, sl=siblingNodes.length; s < sl; s+=1) {
            var siblingNode = siblingNodes[s];
            var append      = false;

            /**
             * Fix for odd IE7 Crash where siblingNode does not exist even though this should be a live nodeList.
             * Example of error visible here: http://www.esquire.com/features/honesty0707
            **/
            if(!siblingNode) {
                continue;
            }

            dbg("Looking at sibling node: " + siblingNode + " (" + siblingNode.className + ":" + siblingNode.id + ")" + ((typeof siblingNode.readability !== 'undefined') ? (" with score " + siblingNode.readability.contentScore) : ''));
            dbg("Sibling has score " + (siblingNode.readability ? siblingNode.readability.contentScore : 'Unknown'));

            if(siblingNode === topCandidate)
            {
                append = true;
            }

            var contentBonus = 0;
            /* Give a bonus if sibling nodes and top candidates have the example same classname */
            if(siblingNode.className === topCandidate.className && topCandidate.className !== "") {
                contentBonus += topCandidate.readability.contentScore * 0.2;
            }

            if(typeof siblingNode.readability !== 'undefined' && (siblingNode.readability.contentScore+contentBonus) >= siblingScoreThreshold)
            {
                append = true;
            }
            
            if(siblingNode.nodeName === "P") {
                var linkDensity = readability.getLinkDensity(siblingNode);
                var nodeContent = readability.getInnerText(siblingNode);
                var nodeLength  = nodeContent.length;
                
                if(nodeLength > 80 && linkDensity < 0.25)
                {
                    append = true;
                }
                else if(nodeLength < 80 && linkDensity === 0 && nodeContent.search(/\.( |$)/) !== -1)
                {
                    append = true;
                }
            }

            if(append) {
                dbg("Appending node: " + siblingNode);

                var nodeToAppend = null;
                if(siblingNode.nodeName !== "DIV" && siblingNode.nodeName !== "P") {
                    /* We have a node that isn't a common block level element, like a form or td tag. Turn it into a div so it doesn't get filtered out later by accident. */
                    
                    dbg("Altering siblingNode of " + siblingNode.nodeName + ' to div.');
                    nodeToAppend = document.createElement("DIV");
                    try {
                        nodeToAppend.id = siblingNode.id;
                        nodeToAppend.innerHTML = siblingNode.innerHTML;
                    }
                    catch(er) {
                        dbg("Could not alter siblingNode to div, probably an IE restriction, reverting back to original.");
                        nodeToAppend = siblingNode;
                        s-=1;
                        sl-=1;
                    }
                } else {
                    nodeToAppend = siblingNode;
                    s-=1;
                    sl-=1;
                }
                
                /* To ensure a node does not interfere with readability styles, remove its classnames */
                nodeToAppend.className = "";

                /* Append sibling and subtract from our list because it removes the node when you append to another node */
                articleContent.appendChild(nodeToAppend);
                siblingNodes.length; //arrix
            }
        }
}, 'grabArticle look through its siblings');

        /**
         * So we have all of the content that we need. Now we clean it up for presentation.
        **/
        readability.prepArticle(articleContent);

        if (readability.curPageNum === 1) {
            articleContent.innerHTML = '<div id="page-1" class="page">' + articleContent.innerHTML + '</div>';
        }

        /**
         * Now that we've gone through the full algorithm, check to see if we got any meaningful content.
         * If we didn't, we may need to re-run grabArticle with different flags set. This gives us a higher
         * likelihood of finding the content, and the sieve approach gives us a higher likelihood of
         * finding the -right- content.
        **/
        if(readability.getInnerText(articleContent, false).length < 250) {
        page.innerHTML = pageCacheHtml;

            if (readability.flagIsActive(readability.FLAG_STRIP_UNLIKELYS)) {
                readability.removeFlag(readability.FLAG_STRIP_UNLIKELYS);
                return readability.grabArticle(page);
            }
            else if (readability.flagIsActive(readability.FLAG_WEIGHT_CLASSES)) {
                readability.removeFlag(readability.FLAG_WEIGHT_CLASSES);
                return readability.grabArticle(page);
            }
            else if (readability.flagIsActive(readability.FLAG_CLEAN_CONDITIONALLY)) {
                readability.removeFlag(readability.FLAG_CLEAN_CONDITIONALLY);
                return readability.grabArticle(page);
            } else {
                return null;
            }
        }
        
        return articleContent;
    },
    
    /**
     * Removes script tags from the document.
     *
     * @param Element
    **/
    removeScripts: function (doc) {
        var scripts = doc.getElementsByTagName('script');
        for(var i = scripts.length-1; i >= 0; i-=1) {
           if (scripts[i].parentNode) {
                scripts[i].parentNode.removeChild(scripts[i]);          
            }
        }
    },
    

    removeStyles: function (doc) {
      readability.removeTags(doc, 'style');
      readability.removeTags(doc, 'iframe');
      // var styles = doc.getElementsByTagName('style');
      // for(var i = styles.length-1; i >= 0; i-=1)
      // {
      //   if (styles[i].parentNode) {
      //     styles[i].parentNode.removeChild(styles[i]);          
      //   }
      // }
    },


    removeTags: function(doc, tag) {
      var tags = doc.getElementsByTagName(tag);
      for(var i = tags.length-1; i >= 0; i-=1) {
        if (tags[i].parentNode) {
          tags[i].parentNode.removeChild(tags[i]);          
        }
      }

    },


    /**
     * Get the inner text of a node - cross browser compatibly.
     * This also strips out any excess whitespace to be found.
     *
     * @param Element
     * @return string
    **/
    getInnerText: function (e, normalizeSpaces) {
        var textContent    = "";

        if(typeof(e.textContent) === "undefined" && typeof(e.innerText) === "undefined") {
            return "";
        }

        normalizeSpaces = (typeof normalizeSpaces === 'undefined') ? true : normalizeSpaces;

        if (navigator.appName === "Microsoft Internet Explorer") {
            textContent = e.innerText.replace( readability.regexps.trim, "" ); }
        else {
            textContent = e.textContent.replace( readability.regexps.trim, "" ); }

        if(normalizeSpaces) {
            return textContent.replace( readability.regexps.normalize, " "); }
        else {
            return textContent; }
    },

    /**
     * Get the number of times a string s appears in the node e.
     *
     * @param Element
     * @param string - what to split on. Default is ","
     * @return number (integer)
    **/
    getCharCount: function (e,s) {
        s = s || ",";
        return readability.getInnerText(e).split(s).length-1;
    },

    /**
     * Remove the style attribute on every e and under.
     * TODO: Test if getElementsByTagName(*) is faster.
     *
     * @param Element
     * @return void
    **/
    cleanStyles: function (e) {
        e = e || document;
        var cur = e.firstChild;

        if(!e) {
            return; }

        // Remove any root styles, if we're able.
        if(typeof e.removeAttribute === 'function' && e.className !== 'readability-styled') {
            e.removeAttribute('style'); }

        // Go until there are no more child nodes
        while ( cur !== null ) {
            if ( cur.nodeType === 1 ) {
                // Remove style attribute(s) :
                if(cur.className !== "readability-styled") {
                    cur.removeAttribute("style");                   
                }
                readability.cleanStyles( cur );
            }
            cur = cur.nextSibling;
        }           
    },
    
    /**
     * Get the density of links as a percentage of the content
     * This is the amount of text that is inside a link divided by the total text in the node.
     * 
     * @param Element
     * @return number (float)
    **/
    getLinkDensity: function (e) {
        var links      = e.getElementsByTagName("a");
        var textLength = readability.getInnerText(e).length;
        var linkLength = 0;
        for(var i=0, il=links.length; i<il;i+=1)
        {
            linkLength += readability.getInnerText(links[i]).length;
        }       

        return linkLength / textLength;
    },
    
    /**
     * Find a cleaned up version of the current URL, to use for comparing links for possible next-pageyness.
     *
     * @author Dan Lacy
     * @return string the base url
    **/
    findBaseUrl: function () {
        var noUrlParams     = window.location.pathname.split("?")[0],
            urlSlashes      = noUrlParams.split("/").reverse(),
            cleanedSegments = [],
            possibleType    = "";

        for (var i = 0, slashLen = urlSlashes.length; i < slashLen; i+=1) {
            var segment = urlSlashes[i];

            // Split off and save anything that looks like a file type.
            if (segment.indexOf(".") !== -1) {
                possibleType = segment.split(".")[1];

                /* If the type isn't alpha-only, it's probably not actually a file extension. */
                if(!possibleType.match(/[^a-zA-Z]/)) {
                    segment = segment.split(".")[0];                    
                }
            }
            
            /**
             * EW-CMS specific segment replacement. Ugly.
             * Example: http://www.ew.com/ew/article/0,,20313460_20369436,00.html
            **/
            if(segment.indexOf(',00') !== -1) {
                segment = segment.replace(',00', '');
            }

            // If our first or second segment has anything looking like a page number, remove it.
            if (segment.match(/((_|-)?p[a-z]*|(_|-))[0-9]{1,2}$/i) && ((i === 1) || (i === 0))) {
                segment = segment.replace(/((_|-)?p[a-z]*|(_|-))[0-9]{1,2}$/i, "");
            }


            var del = false;

            /* If this is purely a number, and it's the first or second segment, it's probably a page number. Remove it. */
            if (i < 2 && segment.match(/^\d{1,2}$/)) {
                del = true;
            }
            
            /* If this is the first segment and it's just "index", remove it. */
            if(i === 0 && segment.toLowerCase() === "index") {
                del = true;
            }

            /* If our first or second segment is smaller than 3 characters, and the first segment was purely alphas, remove it. */
            if(i < 2 && segment.length < 3 && !urlSlashes[0].match(/[a-z]/i)) {
                del = true;
            }

            /* If it's not marked for deletion, push it to cleanedSegments. */
            if (!del) {
                cleanedSegments.push(segment);
            }
        }

        // This is our final, cleaned, base article URL.
        return window.location.protocol + "//" + window.location.host + cleanedSegments.reverse().join("/");
    },

    /**
     * Look for any paging links that may occur within the document.
     * 
     * @param body
     * @return object (array)
    **/
    findNextPageLink: function (elem) {
        var possiblePages = {},
            allLinks = elem.getElementsByTagName('a'),
            articleBaseUrl = readability.findBaseUrl();

        /**
         * Loop through all links, looking for hints that they may be next-page links.
         * Things like having "page" in their textContent, className or id, or being a child
         * of a node with a page-y className or id.
         *
         * Also possible: levenshtein distance? longest common subsequence?
         *
         * After we do that, assign each page a score, and 
        **/
        for(var i = 0, il = allLinks.length; i < il; i+=1) {
            var link     = allLinks[i],
                linkHref = allLinks[i].href.replace(/#.*$/, '').replace(/\/$/, '');

            /* If we've already seen this page, ignore it */
            if(linkHref === "" || linkHref === articleBaseUrl || linkHref === window.location.href || linkHref in readability.parsedPages) {
                continue;
            }
            
            /* If it's on a different domain, skip it. */
            if(window.location.host !== linkHref.split(/\/+/g)[1]) {
                continue;
            }
            
            var linkText = readability.getInnerText(link);

            /* If the linkText looks like it's not the next page, skip it. */
            if(linkText.match(readability.regexps.extraneous) || linkText.length > 25) {
                continue;
            }

            /* If the leftovers of the URL after removing the base URL don't contain any digits, it's certainly not a next page link. */
            var linkHrefLeftover = linkHref.replace(articleBaseUrl, '');
            if(!linkHrefLeftover.match(/\d/)) {
                continue;
            }
            
            if(!(linkHref in possiblePages)) {
                possiblePages[linkHref] = {"score": 0, "linkText": linkText, "href": linkHref};             
            } else {
                possiblePages[linkHref].linkText += ' | ' + linkText;
            }

            var linkObj = possiblePages[linkHref];

            /**
             * If the articleBaseUrl isn't part of this URL, penalize this link. It could still be the link, but the odds are lower.
             * Example: http://www.actionscript.org/resources/articles/745/1/JavaScript-and-VBScript-Injection-in-ActionScript-3/Page1.html
            **/
            if(linkHref.indexOf(articleBaseUrl) !== 0) {
                linkObj.score -= 25;
            }

            var linkData = linkText + ' ' + link.className + ' ' + link.id;
            if(linkData.match(readability.regexps.nextLink)) {
                linkObj.score += 50;
            }
            if(linkData.match(/pag(e|ing|inat)/i)) {
                linkObj.score += 25;
            }
            if(linkData.match(/(first|last)/i)) { // -65 is enough to negate any bonuses gotten from a > or » in the text, 
                /* If we already matched on "next", last is probably fine. If we didn't, then it's bad. Penalize. */
                if(!linkObj.linkText.match(readability.regexps.nextLink)) {
                    linkObj.score -= 65;
                }
            }
            if(linkData.match(readability.regexps.negative) || linkData.match(readability.regexps.extraneous)) {
                linkObj.score -= 50;
            }
            if(linkData.match(readability.regexps.prevLink)) {
                linkObj.score -= 200;
            }

            /* If a parentNode contains page or paging or paginat */
            var parentNode = link.parentNode,
                positiveNodeMatch = false,
                negativeNodeMatch = false;
            while(parentNode) {
                var parentNodeClassAndId = parentNode.className + ' ' + parentNode.id;
                if(!positiveNodeMatch && parentNodeClassAndId && parentNodeClassAndId.match(/pag(e|ing|inat)/i)) {
                    positiveNodeMatch = true;
                    linkObj.score += 25;
                }
                if(!negativeNodeMatch && parentNodeClassAndId && parentNodeClassAndId.match(readability.regexps.negative)) {
                    /* If this is just something like "footer", give it a negative. If it's something like "body-and-footer", leave it be. */
                    if(!parentNodeClassAndId.match(readability.regexps.positive)) {
                        linkObj.score -= 25;
                        negativeNodeMatch = true;                       
                    }
                }
                
                parentNode = parentNode.parentNode;
            }

            /**
             * If the URL looks like it has paging in it, add to the score.
             * Things like /page/2/, /pagenum/2, ?p=3, ?page=11, ?pagination=34
            **/
            if (linkHref.match(/p(a|g|ag)?(e|ing|ination)?(=|\/)[0-9]{1,2}/i) || linkHref.match(/(page|paging)/i)) {
                linkObj.score += 25;
            }

            /* If the URL contains negative values, give a slight decrease. */
            if (linkHref.match(readability.regexps.extraneous)) {
                linkObj.score -= 15;
            }

            /**
             * Minor punishment to anything that doesn't match our current URL.
             * NOTE: I'm finding this to cause more harm than good where something is exactly 50 points.
             *       Dan, can you show me a counterexample where this is necessary?
             * if (linkHref.indexOf(window.location.href) !== 0) {
             *    linkObj.score -= 1;
             * }
            **/

            /**
             * If the link text can be parsed as a number, give it a minor bonus, with a slight
             * bias towards lower numbered pages. This is so that pages that might not have 'next'
             * in their text can still get scored, and sorted properly by score.
            **/
            var linkTextAsNumber = parseInt(linkText, 10);
            if(linkTextAsNumber) {
                // Punish 1 since we're either already there, or it's probably before what we want anyways.
                if (linkTextAsNumber === 1) {
                    linkObj.score -= 10;
                }
                else {
                    // Todo: Describe this better
                    linkObj.score += Math.max(0, 10 - linkTextAsNumber);
                }
            }
        }

        /**
         * Loop thrugh all of our possible pages from above and find our top candidate for the next page URL.
         * Require at least a score of 50, which is a relatively high confidence that this page is the next link.
        **/
        var topPage = null;
        for(var page in possiblePages) {
            if(possiblePages.hasOwnProperty(page)) {
                if(possiblePages[page].score >= 50 && (!topPage || topPage.score < possiblePages[page].score)) {
                    topPage = possiblePages[page];
                }
            }
        }

        if(topPage) {
            var nextHref = topPage.href.replace(/\/$/,'');

            dbg('NEXT PAGE IS ' + nextHref);
            readability.parsedPages[nextHref] = true;
            return nextHref;            
        }
        else {
            return null;
        }
    },

    /**
     * Build a simple cross browser compatible XHR.
     *
     * TODO: This could likely be simplified beyond what we have here right now. There's still a bit of excess junk.
    **/
    xhr: function () {
        if (typeof XMLHttpRequest !== 'undefined' && (window.location.protocol !== 'file:' || !window.ActiveXObject)) {
            return new XMLHttpRequest();
        }
        else {
            try { return new ActiveXObject('Msxml2.XMLHTTP.6.0'); } catch(sixerr) { }
            try { return new ActiveXObject('Msxml2.XMLHTTP.3.0'); } catch(threrr) { }
            try { return new ActiveXObject('Msxml2.XMLHTTP'); } catch(err) { }
        }

        return false;
    },

    successfulRequest: function (request) {
        return (request.status >= 200 && request.status < 300) || request.status === 304 || (request.status === 0 && request.responseText);
    },

    ajax: function (url, options) {
        var request = readability.xhr();

        function respondToReadyState(readyState) {
            if (request.readyState === 4) {
                if (readability.successfulRequest(request)) {
                    if (options.success) { options.success(request); }
                }
                else {
                    if (options.error) { options.error(request); }
                }
            }
        }

        if (typeof options === 'undefined') { options = {}; }

        request.onreadystatechange = respondToReadyState;
        
        request.open('get', url, true);
        request.setRequestHeader('Accept', 'text/html');

        try {
            request.send(options.postBody);
        }
        catch (e) {
            if (options.error) { options.error(); }
        }

        return request;
    },

    /**
     * Make an AJAX request for each page and append it to the document.
    **/
    curPageNum: 1,

    appendNextPage: function (nextPageLink) {
        readability.curPageNum+=1;

        var articlePage       = document.createElement("DIV");
        articlePage.id        = 'page-' + readability.curPageNum;
        articlePage.className = 'page';
        articlePage.innerHTML = '<p class="page-separator" title="Page ' + readability.curPageNum + '">&sect;</p>';

        document.getElementById("content").appendChild(articlePage);

        if(readability.curPageNum > readability.maxPages) {
            var nextPageMarkup = "<div style='text-align: center'><a href='" + nextPageLink + "'>View Next Page</a></div>";

            articlePage.innerHTML = articlePage.innerHTML + nextPageMarkup;
            return;
        }
        
        /**
         * Now that we've built the article page DOM element, get the page content
         * asynchronously and load the cleaned content into the div we created for it.
        **/
        (function(pageUrl, thisPage) {
            readability.ajax(pageUrl, {
                success: function(r) {

                    /* First, check to see if we have a matching ETag in headers - if we do, this is a duplicate page. */
                    var eTag = r.getResponseHeader('ETag');
                    if(eTag) {
                        if(eTag in readability.pageETags) {
                            dbg("Exact duplicate page found via ETag. Aborting.");
                            articlePage.style.display = 'none';
                            return;
                        } else {
                            readability.pageETags[eTag] = 1;
                        }                       
                    }

                    // TODO: this ends up doubling up page numbers on NYTimes articles. Need to generically parse those away.
                    var page = document.createElement("DIV");

                    /**
                     * Do some preprocessing to our HTML to make it ready for appending.
                     * • Remove any script tags. Swap and reswap newlines with a unicode character because multiline regex doesn't work in javascript.
                     * • Turn any noscript tags into divs so that we can parse them. This allows us to find any next page links hidden via javascript.
                     * • Turn all double br's into p's - was handled by prepDocument in the original view.
                     *   Maybe in the future abstract out prepDocument to work for both the original document and AJAX-added pages.
                    **/
                    var responseHtml = r.responseText.replace(/\n/g,'\uffff').replace(/<script.*?>.*?<\/script>/gi, '');
                    responseHtml = responseHtml.replace(/\n/g,'\uffff').replace(/<script.*?>.*?<\/script>/gi, '');
                    responseHtml = responseHtml.replace(/\uffff/g,'\n').replace(/<(\/?)noscript/gi, '<$1div');
                    responseHtml = responseHtml.replace(readability.regexps.replaceBrs, '</p><p>');
                    responseHtml = responseHtml.replace(readability.regexps.replaceFonts, '<$1span>');
                    
                    page.innerHTML = responseHtml;

                    /**
                     * Reset all flags for the next page, as they will search through it and disable as necessary at the end of grabArticle.
                    **/
                    readability.flags = 0x1 | 0x2 | 0x4;

                    var nextPageLink = readability.findNextPageLink(page),
                        content      =  readability.grabArticle(page);

                    if(!content) {
                        dbg("No content found in page to append. Aborting.");
                        return;
                    }

                    /**
                     * Anti-duplicate mechanism. Essentially, get the first paragraph of our new page.
                     * Compare it against all of the the previous document's we've gotten. If the previous
                     * document contains exactly the innerHTML of this first paragraph, it's probably a duplicate.
                    **/
                    var firstP = content.getElementsByTagName("P").length ? content.getElementsByTagName("P")[0] : null;
                    if(firstP && firstP.innerHTML.length > 100) {
                        for(var i=1; i <= readability.curPageNum; i+=1) {
                            var rPage = document.getElementById('page-' + i);
                            if(rPage && rPage.innerHTML.indexOf(firstP.innerHTML) !== -1) {
                                dbg('Duplicate of page ' + i + ' - skipping.');
                                articlePage.style.display = 'none';
                                readability.parsedPages[pageUrl] = true;
                                return;
                            }
                        }
                    }
                    
                    readability.removeScripts(content);

                    thisPage.innerHTML = thisPage.innerHTML + content.innerHTML;

                    if(nextPageLink) {
                        readability.appendNextPage(nextPageLink);
                    }
                }
            });
        }(nextPageLink, articlePage));
    },
    
    /**
     * Get an elements class/id weight. Uses regular expressions to tell if this 
     * element looks good or bad.
     *
     * @param Element
     * @return number (Integer)
    **/
    getClassWeight: function (e) {
        if(!readability.flagIsActive(readability.FLAG_WEIGHT_CLASSES)) {
            return 0;
        }

        var weight = 0;

        /* Look for a special classname */
        if (typeof(e.className) === 'string' && e.className !== '')
        {
            if(e.className.search(readability.regexps.negative) !== -1) {
                weight -= 25; }

            if(e.className.search(readability.regexps.positive) !== -1) {
                weight += 25; }
        }

        /* Look for a special ID */
        if (typeof(e.id) === 'string' && e.id !== '')
        {
            if(e.id.search(readability.regexps.negative) !== -1) {
                weight -= 25; }

            if(e.id.search(readability.regexps.positive) !== -1) {
                weight += 25; }
        }

        return weight;
    },

    nodeIsVisible: function (node) {
        return (node.offsetWidth !== 0 || node.offsetHeight !== 0) && node.style.display.toLowerCase() !== 'none';
    },

    /**
     * Remove extraneous break tags from a node.
     *
     * @param Element
     * @return void
     **/
    killBreaks: function (e) {
        try {
            e.innerHTML = e.innerHTML.replace(readability.regexps.killBreaks,'<br />');       
        }
        catch (eBreaks) {
            dbg("KillBreaks failed - this is an IE bug. Ignoring.: " + eBreaks);
        }
    },

    /**
     * Clean a node of all elements of type "tag".
     * (Unless it's a youtube/vimeo video. People love movies.)
     *
     * @param Element
     * @param string tag to clean
     * @return void
     **/
    clean: function (e, tag) {
        var targetList = e.getElementsByTagName( tag );
        var isEmbed    = (tag === 'object' || tag === 'embed');
        
        for (var y=targetList.length-1; y >= 0; y-=1) {
            /* Allow youtube and vimeo videos through as people usually want to see those. */
            if(isEmbed) {
                var attributeValues = "";
                for (var i=0, il=targetList[y].attributes.length; i < il; i+=1) {
                    attributeValues += targetList[y].attributes[i].value + '|';
                }
                
                /* First, check the elements attributes to see if any of them contain youtube or vimeo */
                if (attributeValues.search(readability.regexps.videos) !== -1) {
                    continue;
                }

                /* Then check the elements inside this element for the same. */
                if (targetList[y].innerHTML.search(readability.regexps.videos) !== -1) {
                    continue;
                }
                
            }

            targetList[y].parentNode.removeChild(targetList[y]);
        }
    },
    
    /**
     * Clean an element of all tags of type "tag" if they look fishy.
     * "Fishy" is an algorithm based on content length, classnames, link density, number of images & embeds, etc.
     *
     * @return void
     **/
    cleanConditionally: function (e, tag) {

        if(!readability.flagIsActive(readability.FLAG_CLEAN_CONDITIONALLY)) {
            return;
        }

        var tagsList      = e.getElementsByTagName(tag);
        var curTagsLength = tagsList.length;

        /**
         * Gather counts for other typical elements embedded within.
         * Traverse backwards so we can remove nodes at the same time without effecting the traversal.
         *
         * TODO: Consider taking into account original contentScore here.
        **/
        for (var i=curTagsLength-1; i >= 0; i-=1) {
            var weight = readability.getClassWeight(tagsList[i]);
            var contentScore = (typeof tagsList[i].readability !== 'undefined') ? tagsList[i].readability.contentScore : 0;
            
            dbg("Cleaning Conditionally " + tagsList[i] + " (" + tagsList[i].className + ":" + tagsList[i].id + ")" + ((typeof tagsList[i].readability !== 'undefined') ? (" with score " + tagsList[i].readability.contentScore) : ''));

            if(weight+contentScore < 0)
            {
                tagsList[i].parentNode.removeChild(tagsList[i]);
            }
            else if ( readability.getCharCount(tagsList[i], readability.reComma) < 10) { //arrix
                /**
                 * If there are not very many commas, and the number of
                 * non-paragraph elements is more than paragraphs or other ominous signs, remove the element.
                **/
                var p      = tagsList[i].getElementsByTagName("p").length;
                var img    = tagsList[i].getElementsByTagName("img").length;
                var li     = tagsList[i].getElementsByTagName("li").length-100;
                var input  = tagsList[i].getElementsByTagName("input").length;

                var embedCount = 0;
                var embeds     = tagsList[i].getElementsByTagName("embed");
                for(var ei=0,il=embeds.length; ei < il; ei+=1) {
                    embeds[ei].src = embeds[ei].getAttribute('src'); //arrix jsdom doesn't create embed.src
                    if (embeds[ei].src.search(readability.regexps.videos) === -1) {
                      embedCount+=1; 
                    }
                }

                var linkDensity   = readability.getLinkDensity(tagsList[i]);
                var contentLength = readability.getInnerText(tagsList[i]).length;
                var toRemove      = false;

                if ( img > p ) {
                    toRemove = true;
                } else if(li > p && tag !== "ul" && tag !== "ol") {
                    toRemove = true;
                } else if( input > Math.floor(p/3) ) {
                    toRemove = true; 
                } else if(contentLength < 25 && (img === 0 || img > 2) ) {
                    toRemove = true;
                } else if(weight < 25 && linkDensity > 0.2) {
                    toRemove = true;
                } else if(weight >= 25 && linkDensity > 0.5) {
                    toRemove = true;
                } else if((embedCount === 1 && contentLength < 75) || embedCount > 1) {
                    toRemove = true;
                }

                if(toRemove) {
                    tagsList[i].parentNode.removeChild(tagsList[i]);
                }
            }
        }
    },

    /**
     * Clean out spurious headers from an Element. Checks things like classnames and link density.
     *
     * @param Element
     * @return void
    **/
    cleanHeaders: function (e) {
        for (var headerIndex = 1; headerIndex < 3; headerIndex+=1) {
            var headers = e.getElementsByTagName('h' + headerIndex);
            for (var i=headers.length-1; i >=0; i-=1) {
                if (readability.getClassWeight(headers[i]) < 0 || readability.getLinkDensity(headers[i]) > 0.33) {
                    headers[i].parentNode.removeChild(headers[i]);
                }
            }
        }
    },

    /*** Smooth scrolling logic ***/
    
    /**
     * easeInOut animation algorithm - returns an integer that says how far to move at this point in the animation.
     * Borrowed from jQuery's easing library.
     * @return integer
    **/
    easeInOut: function(start,end,totalSteps,actualStep) { 
        return 0;
    },
    
    /**
     * Helper function to, in a cross compatible way, get or set the current scroll offset of the document.
     * @return mixed integer on get, the result of window.scrollTo on set
    **/
    scrollTop: function(scroll){},
    
    /**
     * scrollTo - Smooth scroll to the point of scrollEnd in the document.
     * @return void
    **/
    curScrollStep: 0,
    scrollTo: function (scrollStart, scrollEnd, steps, interval) {},

    
    /**
     * Show the email popup.
     *
     * @return void
     **/
    emailBox: function () {},
    
    /**
     * Close the email popup. This is a hacktackular way to check if we're in a "close loop".
     * Since we don't have crossdomain access to the frame, we can only know when it has
     * loaded again. If it's loaded over 3 times, we know to close the frame.
     *
     * @return void
     **/
    removeFrame: function () {
        readability.iframeLoads+=1;
        if (readability.iframeLoads > 3)
        {
            var emailContainer = document.getElementById('email-container');
            if (null !== emailContainer) {
                emailContainer.parentNode.removeChild(emailContainer);
            }

            readability.iframeLoads = 0;
        }           
    },
    
    htmlspecialchars: function (s) {
        if (typeof(s) === "string") {
            s = s.replace(/&/g, "&amp;");
            s = s.replace(/"/g, "&quot;");
            s = s.replace(/'/g, "&#039;");
            s = s.replace(/</g, "&lt;");
            s = s.replace(/>/g, "&gt;");
        }
    
        return s;
    },

    flagIsActive: function(flag) {
        return (readability.flags & flag) > 0;
    },
    
    addFlag: function(flag) {
        readability.flags = readability.flags | flag;
    },
    
    removeFlag: function(flag) {
        readability.flags = readability.flags & ~flag;
    }
    
};

// func should return a node. The returned node will become the current node.
// return null means the node is removed.
// if returnedNode.oneMoreTime == true, it will be walked over again.
var LiveTagWalker = function(root, tag, func) {
  tag = tag.toUpperCase();
  var anyTag = tag == '*';

  function walk(cur) {
    var returnedNode, nextNode;
    while (cur) {
      nextNode = cur.nextSibling; //save a reference to the nextSibling. after a node is removed, node.nextSibling will be null
      if (cur.nodeType == 1) {
        if (anyTag || cur.tagName == tag) {
          returnedNode = func(cur);
          assert.ok(returnedNode !== undefined, 'must return either a Node or null');
          if (returnedNode) {
            cur = returnedNode;
            nextNode = cur.nextSibling
            if (cur.oneMoreTime) {
              // the node is replaced and the replacement node should be walked again
              delete cur.oneMoreTime;
              continue;
            } else {
              walk(cur.firstChild);
            }
          } else {
            //the node is removed
          }
        } else {
          walk(cur.firstChild);
        }
      }
      cur = nextNode;
    } // while

  }
  walk(root.firstChild);
};

//==============================================================================
var Utils = {
  extend: function(/* dst, src1, src2, ... */) {
    var args = [].slice.call(arguments);
    var dst = args.shift();

    for (var i = 0, l = args.length, src; src = args[i], i < l; i++) {
      for (var k in src) {
        dst[k] = src[k];
      }
    }
    return dst;
  }
};


var jsdom = require('jsdom'),
  assert = require('assert'),
  mod_sprintf = require('./sprintf'),
  sprintf = mod_sprintf.sprintf;

// var util;
// try {
//  util = require('util');
// } catch(e) {
//  util = {
//    debug: function(a) { console.log(a); },
//    log: function(a) { console.log(a); }
//  }
// }
//LiveTagWalker(document.body, '*', function(n) {dbg(n.tagName + n.id + n.className);}),0;

(function() {
  var R = readability;
  var patch = {
    reComma: /[\uff0c,]/, // chinese comma, too
    findNextPageLink: function() {return null;},
    getArticleTools: function() {return document.createElement('div');},
    getArticleTitle: (function() {
      var old = R.getArticleTitle;
      return function() {
        var elm = old.call(R);
        elm.id = "article-title";
        return elm;
      };
    })(),
    getArticleFooter: function () {
      return document.createElement("DIV");
    },

    // hundredfold faster
    // use native string.trim
    // jsdom's implementation of textContent is innerHTML + strip tags + HTMLDecode
    // here we replace it with an optimized tree walker
    getInnerText: function (e, normalizeSpaces) {
      if (normalizeSpaces === undefined) normalizeSpaces = true;

      function TextWalker(node, func) {
        function walk(cur) {
          var children, len, i;
          if (cur.nodeType == 3) {
            func(cur);
            return;
          } else if (cur.nodeType != 1) {
            return;
          }

          children = cur.childNodes;
          for (i = 0, len = children.length; i < len; i++) {
            walk(children[i]);
          }
        }
        walk(node);
      }

      var textContent = '';
      TextWalker(e, function(cur) {
        textContent += cur.nodeValue;
      });
      textContent = textContent.trim();
      //var textContent = e.textContent.trim();

      if(normalizeSpaces) {
        return textContent.replace( readability.regexps.normalize, " "); }
      else {
        return textContent;
      }
    },

    cleanStyles: function (e) {
      e = e || document;
      // var all = e.getElementsByTagName('*'), i, len, node;
      // for (i = 0, len = all.length; i < len; i++) {
      //     node = all[i];
      //     if (node.className != 'readability-styled') {
      //       node.removeAttribute("style");
      //     }
      // }
      // return;

      function walk(cur) {
        var children, i, l;

        if (cur.nodeType == 1) {
          if (cur.className != 'readability-styled') {
            cur.removeAttribute("style");
          }

          children = cur.childNodes;
          for (i = 0, l = children.length; i < l; i++) {
            walk(children[i]);
          }
        }
      }
      walk(e);
    },

    //// new methods ///
    reset: function() {
      var z = this;
      z.iframeLoads = 0;
      z.bodyCache = true; //bodyCache seems to be unused. make it true to avoid creation
      z.flags = 0x1 | 0x2 | 0x4;
      z.parsedPages = {};
      z.pageETags = {};
    },


    removeCommentNodes: function(document) {
      try {
        var body = document.body;


        var getAttributes = function(node){ 
          if(!node) return "";

          return [ 
             node.getAttribute('id')
            ,node.getAttribute('class')
            ,node.getAttribute('name')
            ,node.getAttribute('rel')
          ].join(" ");
        }      
        var isCommentNode = function(node) {
          if( !node || !node.getAttribute ) return false;

          var attributes = getAttributes(node);
          return ! POSSIBLE_CONTENT_NODE_REGEX.test(attributes) && COMMENT_NODE_REGEX.test(getAttributes(node));
        }      

        var process = function(node) {
          if(!node) return;

          var n;
          for (var i = node.childNodes._length - 1; i >= 0; i-- ) {
            // log(i)
            n = node.childNodes[i];

            if( isCommentNode(n) ) {
              log("Remove possible comment node node ".red, getAttributes(n));
              n.parentNode.removeChild(n);
            } else {
              process(n);
            }
              
          }
        }

        process(body);
      } catch(ex) {
        log(ex);
      }

      
    }


  };

  for (var k in patch) R[k] = patch[k];
})();

var MyProfiler = {
  stats: {},
  timed_level: 0,
  enabled: false,
  timed: function(func, name, options) {
    if (!MyProfiler.enabled) return func();
    options = options || {};
    var z = this;
    //dbg('begin ' + name);
    z.timed_level++;
    name = name || func.name;
    if (!z.stats[name]) z.stats[name] = 0;
    var st = z.stats[name] || (z.stats[name] = {count: 0, time: 0});
    var time = new Date().getTime();
    var ret = func();
    var ellapsed = new Date().getTime() - time;
    st.time += ellapsed;
    st.count++;
    if (!options.silent)
      dbg(new Array(z.timed_level).join('  ') + ellapsed / 1000 + ' seconds [' + name + '] ' + (options.moreInfo || ''));
    z.timed_level--;
    return ret;
  },

  timerize: function(name, funcName, obj, options) {
    var f = obj[funcName];
    obj[funcName] = function() {
      var z = this;
      var args = [].slice.call(arguments);
      return timed(function() { return f.apply(z, args)}, name, options);
    }
  },

  report: function() {
    dbg('Profiling summary ==========================');
    var stats = this.stats;
    for (var name in stats) {
      var st = stats[name];
      dbg(sprintf("%5d\t%7.3f\t%s", st.count, st.time / 1000, name));
    };
  },

  reset: function() {
    this.stats = {};
    this.timed_level = 0;
  }
};

function timed() {
  return MyProfiler.timed.apply(MyProfiler, arguments);
}

// (function() {
//  MyProfiler.timerize('================= TOTAL', 'init', readability);
//  //return;
//  MyProfiler.timerize('prepDocument', 'prepDocument', readability);
//  MyProfiler.timerize('prepArticle', 'prepArticle', readability);
//  MyProfiler.timerize('grabArticle', 'grabArticle', readability);

//  //608   2.431 most time taken by getInnerText
//  MyProfiler.timerize('getLinkDensity', 'getLinkDensity', readability, {silent: true});
//  MyProfiler.timerize('getInnerText', 'getInnerText', readability, {silent: true});
//  MyProfiler.timerize('cleanConditionally', 'cleanConditionally', readability);
//  //MyProfiler.timerize('clean', 'clean', readability);
//  //MyProfiler.timerize('killBreaks', 'killBreaks', readability);
//  //MyProfiler.timerize('cleanStyles', 'cleanStyles', readability, {silent: true});
//  //MyProfiler.timerize('cleanHeaders', 'cleanHeaders', readability);

//  // 627 0.013
//  //MyProfiler.timerize('getClassWeight', 'getClassWeight', readability, {silent: true});

//  //MyProfiler.timerize('getElementsByTagName', 'getElementsByTagName', jsdom.defaultLevel.Element.prototype, {silent: true});
//  //MyProfiler.timerize('update', 'update', jsdom.defaultLevel.NodeList.prototype, {silent: true});
//  //MyProfiler.timerize('removeAttribute', 'removeAttribute', jsdom.defaultLevel.Element.prototype, {silent: true});

// })();

function removeReadabilityArtifacts() {
  var titleContainer = document.getElementById('article-title');
  if (null !== titleContainer) {
    document.title = titleContainer.innerHTML;
  }
  
  var contentContainer = document.getElementById('page-1');
  if (null !== contentContainer) {
    document.body.innerHTML = contentContainer.innerHTML;
  }
}

function removeClassNames(e) {
  var e = e || document;
  var cur = e.firstChild;

  if(!e) {
    return; }

  // Remove any root class names, if we're able.
  if(e.className) {
    e.className = "";
  }

  // Go until there are no more child nodes
  while ( cur !== null ) {
    if ( cur.nodeType === 1 ) {
      // Remove class names
      if(e.className) {
        e.className = "";
      }
      removeClassNames(cur);
    }
    cur = cur.nextSibling;
  }           
}

var window, document;

function start(w, doc, options, cb) {
  window = w;
  document = doc;

  // console.log(document)

  // console.log(window.location.href)

  readConvertLinksToFootnotes=false;readStyle='style-novel';readSize='size-medium';readMargin='margin-wide';

  navigator = w.navigator;
  location = w.location;
  w.scrollTo = function(){};

  readability.reset();
  readability.debugging = options.debug;
  
  MyProfiler.enabled = options.profile;
  if (options.profile) {
    MyProfiler.reset();
  }

  
  readability.init();
  

  if (options.profile) MyProfiler.report();
  
  if (options.removeReadabilityArtifacts) removeReadabilityArtifacts();
  if (options.removeClassNames) removeClassNames();

  dbg('[Readability] done');
  cb(document.body.innerHTML);
}

var HTML5;
try {
  HTML5 = require('html5');
} catch(e) {
  log ("Unable to load HTML5");

}






/* WALLE */

function extractImageWithOpenGraph(document) {
  var metas = document.getElementsByTagName("meta");
  var property;
  for(var i = 0, len = metas.length; i < len; i++) {
    if( (metas[i].getAttribute('property') || "").toLowerCase() == 'og:image' )
      return metas[i].getAttribute('content');
  }
}

function extractImages(doc, baseUrl) {
  // should look for openGraph
  var image = extractImageWithOpenGraph(doc);
  if (image) return [{url: normalizeUrl(image, baseUrl)}];
    

  /* IMAGES */
  var validImage;
  var blackListedDomains = [
    /media-cache.+\.pinterest.com/i,
    /media-cache.+\.pinimg.com/i
  ]

  validImage = function(url, width, height) {
    var blackListed, minHeight, minWidth, _i, _len;
    if (!/\.jpe?g/i.test(url)) {
      return false;
    }
    for (_i = 0, _len = blackListedDomains.length; _i < _len; _i++) {
      blackListed = blackListedDomains[_i];
      if (blackListed.test(url)) {
        return false;
      }
    }
    minWidth = 100;
    minHeight = 100;
    if (width && height) {
      if (width < minWidth || height < minHeight) {
        return false;
      }
    }
    return true;
  };

  var alt, height, image, images, imgTag, imgTags, style, url, width, _i, _len;

  imgTags = doc.getElementsByTagName("img");

  images = [];

  for (_i = 0, _len = imgTags.length; _i < _len; _i++) {
    imgTag = imgTags[_i];
    if (imgTag.getAttribute) {
      url = imgTag.getAttribute('src');
      width = +imgTag.getAttribute("width");
      height = +imgTag.getAttribute("height");
      style = imgTag.getAttribute("style") || "";
      alt = imgTag.getAttribute("alt");
      if (width === "") {
        width = +/width:\s*(\d+)px/i.exec(style)[1];
      }
      if (height === "") {
        height = +/height:\s*(\d+)px/i.exec(style)[1];
      }
      if (/\?w=(\d+)&h=(\d+)/i.test(url)) {
        width = +RegExp.$1;
        height = +RegExp.$2;
      }
      if (validImage(url, width, height)) {
        image = {
          url: normalizeUrl(url, baseUrl),
          width: width,
          height: height
        };
        if (width && height) {
          image.algorithm = "inline";
        }
        if (alt) {
          image.caption = alt;
        }
        images.push(image);
      }
    }
  }

  return images;
}

var nodeUrl = require('url');

// resolve relative url ../../blah to absolute url
// useful for relative images 
function normalizeUrl(absOrRelativeUrl, url) {
  if (!url) url = "";
  if(!/^http/i.test(absOrRelativeUrl)) {
    log( "Resolving".red, nodeUrl.resolve(url, absOrRelativeUrl) )
    return nodeUrl.resolve(url, absOrRelativeUrl);
  }
  return absOrRelativeUrl;
}


var AUTHOR_REGEX = /byline|author/i;
var AUTHOR_META_REGEX = /author|twitter\:creator/i;
var BLACK_LISTED_AUTHOR_META = /author_fbid/i;
var AUTHOR_STOP_WORDS = /google|twitter|facebook|plus|rss|e.?mail|contact|view|website|subscribe|feed|continue|comment|follow|about|more|report/i;

var COMMENT_NODE_REGEX = /disqus|comment|archive|widget/i;
var POSSIBLE_CONTENT_NODE_REGEX = /content|post|entry/i;



var NODE_TYPES = {
  ELEMENT_NODE:  1,
  ATTRIBUTE_NODE:  2,
  TEXT_NODE: 3,
  CDATA_SECTION_NODE:  4,
  ENTITY_REFERENCE_NODE: 5,
  ENTITY_NODE: 6,
  PROCESSING_INSTRUCTION_NODE: 7,
  COMMENT_NODE:  8,
  DOCUMENT_NODE: 9,
  DOCUMENT_TYPE_NODE:  10,
  DOCUMENT_FRAGMENT_NODE:  11,
  NOTATION_NODE: 12
}


function extractAuthorWithMetaData(document) {
  var metas = document.getElementsByTagName('meta');
  var meta, content;
  var possibleAuthors = {};
  var attributes;
  for( var i = 0, len = metas._length; i < len; i++) {
    meta = metas[i];
    attributes = [
      meta.getAttribute('property')
      ,meta.getAttribute('name')
    ].join( " " ).trim()
    if ( AUTHOR_META_REGEX.test(attributes) && !BLACK_LISTED_AUTHOR_META.test(attributes) ) {
      content = meta.getAttribute('content');
      if (/http\:/i.test(content) ) continue;

      if ( !possibleAuthors[ content ] )
        possibleAuthors[ meta.getAttribute('content') ] = 0;
      possibleAuthors[ meta.getAttribute('content') ]++;
    }
  }

  var sortedAuthors = [];
  for(var author in possibleAuthors) {
    sortedAuthors.push({author: author, count:possibleAuthors[author], algorithm: "meta"  });
  }
  sortedAuthors.sort( function(a,b){ return b.count - a.count; })

  return sortedAuthors;
}



function extractAuthor(document) {
  var author;

  var tag, 
      allNodes = document.getElementsByTagName('*'),
      possibleAuthor, 
      allAuthors = {},
      authors = [],
      authorCount = 0;

  var authorNodes = {};

  var possibleAuthorNodes = [];

  log("allNodes.length", allNodes._length)

  var curNode;
  for(var i = 0, len = allNodes._length; i < len; i++) {
    curNode = allNodes[i];
    if(curNode.nodeType != NODE_TYPES.ELEMENT_NODE) continue;

    possibleAuthorNodes = possibleAuthorNodes.concat( extractAuthorFromNode(curNode) );
  }


  possibleAuthorNodes = dedupPossibleAuthorNodes( possibleAuthorNodes );
  log( " Total author found:".green, possibleAuthorNodes.length )
  log( possibleAuthorNodes )

  return possibleAuthorNodes[0];
}    

// from Coffeescript
function mergeHash(original, hashToMerge) {
  for (var prop in hashToMerge) {
    if ( hashToMerge.hasOwnProperty(prop) ) {
      original[prop] = hashToMerge[prop];
    }
  }
  return original;
}



function extractAuthorFromNode(node) {
  var authors = [],
      authorCount = 0,
      allAuthors= {};
  var authorNodes = {}

  var possibleAuthorNodes = [];

  var attributes = [ 
    node.getAttribute('id')
    ,node.getAttribute('class')
    ,node.getAttribute('name')
    ,node.getAttribute('rel')
    ,node.getAttribute('href')
  ].join(" ");

  if ( AUTHOR_REGEX.test(attributes) ) {

    possibleAuthor = readability.getInnerText(node).trim();

    log("attributes: ", node.tagName + " - " + attributes)
    log("possibleAuthor:", possibleAuthor);
    log("child nodes length", node.childNodes.length)

    possibleAuthorNodes = possibleAuthorNodes.concat( locateAuthorNode(node, possibleAuthor) );

    if(possibleAuthorNodes.length > 0 ) {
      log( possibleAuthorNodes.length);
    } else {
      log("not found authorNode")
    }
  }

  return possibleAuthorNodes;
}    



function locateAuthorNode(node, possibleAuthor, preceedingValue, level) {
  var found = [];
  var space = "";
  if(!preceedingValue) preceedingValue = "";
  if(!level) level = 1;
  for(var i = 0; i < level; i++) {
    space += "  "
  }
  if ( typeof node.nodeValue != "undefined" && node.nodeValue != null) {
    var nodeValue = node.nodeValue.trim();
    if ( nodeValue.length > 2 && nodeValue.split(" ").length <= 5 
         && !/[\d]/.test(nodeValue) // don't match email or author with numbers
         && !AUTHOR_STOP_WORDS.test(nodeValue) ) {
      log(space + "candidate added".green, nodeValue, " - preceedingValue", preceedingValue);

      // boost if the name follows after By, e.g.  By John Doe
      found.push( {value: node.nodeValue, node: node, boost: /\bby\b/i.test(preceedingValue) ? 1 : 0 });
    }
  } else {
    var childNode;
    var siblingsPreceedingValue = ""
    for (var i = 0, len = node.childNodes._length; i < len; i++) {
      childNode = node.childNodes[i];
      childContent = readability.getInnerText(childNode).trim();

      log( space + "content: ", childContent);

      if (childContent.length > 2 && childContent.length <= possibleAuthor.length ) {
        log( space + "looking into child node ", childNode.tagName);
        
          
        found = found.concat(locateAuthorNode(childNode, childContent, preceedingValue + " " + siblingsPreceedingValue.trim(), level + 1));
      } else {
        siblingsPreceedingValue += " " + childContent;
      }


    }
  }

  return found; 

}


function dedupPossibleAuthorNodes(possibleAuthorNodes) {
  var authors = {};
  var value;
  var scores = [];
  for( var i = 0; i < possibleAuthorNodes.length; i++ ) {
    value = possibleAuthorNodes[i].value.trim()
    if( !authors[ value ] ) {
      authors[ value ] = [];
      scores[ value ] = 0;
    }
      
    authors[ value ].push(possibleAuthorNodes[i].node);
    scores[ value ] += 1 + possibleAuthorNodes[i].boost;
  }

  var sortedAuthors = [];
  for(var author in authors) {
    var boost = 0;

    // handle case for http://www.detroitnews.com/article/20130506/NATION/305060333/1020/Israel-boosts-defenses-while-Syria-Iran-hint-airstrike-reprisals
    // By Karin Laub and Josef Federman  Associated Press
    if (/\band\b/.test(authors[author] ) )
      boost = 99;

    // case for http://news.mtv.ca/blogs/fresh-effects/teen-mom-2-bonus-scene-jeremy-and-corey-set-aside-their-differences-for-alis-sake/
    if( /\:/.test(author) )
      boost = - 0.1;

    sortedAuthors.push( {author: author.trim(), nodes: authors[author], score: scores[author] + boost});
  }
  sortedAuthors.sort( function(a,b){ return b.score - a.score; })
  

  // log("Done dedupPossibleAuthorNodes")
  return sortedAuthors;
}



var POSSIBLE_DATE_REGEX = /publish|publishdate|lastModifiedDate|date|time|datePublished|displaydate/i,
    BLACK_LISTED_DATE_META_REGEX = /msvalidate|timezone/i,
                              // fox news
    EXACT_DATE_META_REGEX = /dc\.date/i,
    POSSIBLE_DATE_VALUE = /\b20\d\d|\bJan|\bFeb|\bMar|\bApril|\bMay|\bJun|\bJul|\bAug|\bSep|\bOct|\bNov|\bDec|\bSun|\bMon|\bTue|\bWed|\bThu|\bFri|\bSat|\d+[\\|\/]\d+[\\|\/]\d{2}/i,
    HUMAN_DATE_FORMAT = /(\d+\s*\b\w+\b\s*ago)/i;





function tryParsingDate( possibleDate ) {
  var publishedDate;
  var date;
  try {
    // console.log("parsing ", possibleDate)

    // handle older NYTimes date format of 20101028
    if (/\d{6}/.test(possibleDate)) {
      publishedDate = moment(possibleDate, "YYYYMMDD").format('YYYY-MM-DD');
    } else {

      possibleDate = possibleDate.replace(/\bat/i, '') // handle MAY 6, 2013 AT 1:00 AM -- remove at
      possibleDate = possibleDate.replace(/th|st/ig, '' ) // handle February 4th, 2013  10:58 am -- remove th and st
      // possibleDate = possibleDate.replace(/[ap]m/ig, '' ).replace(/\d+\:\d+\s*[ap]m/ig, '')
      possibleDate = possibleDate.replace(/\d+\s*\:\d+\s*[ap]m/ig,'') // strip time
      possibleDate = possibleDate.replace(/p[ds]t|e[ds]t|m[ds]t|c[ds]t/ig,'') // strip timezone
      log("Trying to parse: possibleDate")
      date = moment(possibleDate);
      if (date.isValid())
        publishedDate = date.format("YYYY-MM-DD");
      // else 
      //   publishedDate = dateish.parse(possibleDate);

    }
      
  } catch( ex ) {
    ; // don't do anything
    // console.log("exception:", ex.stack)
    log("ERROR parsing date".red + possibleDate);
  }

  return publishedDate;
}



function extractDateFromUrl(url) {
  log('Attemp to parse date from URL... ' + url)
  var date;
  // handle http://ruvr.co.uk/2013_05_02/Controversial-Mariinsky-2-opens/
  // and    http://petapixel.com/2013/05/03/why-you-should-generally-only-show-5-photos-from-any-set/
  if (/\/(\d{4}.\d{1,2}.\d{1,2})/.test(url)) {
    date = tryParsingDate( RegExp.$1.replace(/\D/g,'/') )
    // make sure the date is at least valid 
    // eg. http://ibnlive.in.com/news/president-pranab-mukherjee-asks-judiciary-to-observe-self-discipline/389883-3.html
    // withuot the check will pass 
    log(date.split('-')[0])
    var year = date && date.split('-')[0]
    if(year <= (new Date()).getFullYear() && year >= "1990" )  {
      log("Found date from URL:".green, date);
      return date; 
    }
  };
    
  return null;      
}


function extractDateWithMetaData(document) {
  var metas = document.getElementsByTagName('meta');
  var meta;
  var possibleDates = {};
  var attributes;
  for( var i = 0, len = metas._length; i < len; i++) {
    meta = metas[i];
    attributes = [
      meta.getAttribute('property')
      ,meta.getAttribute('name')
      ,meta.getAttribute('itemprop')
    ].join( " " ).trim();
    if ( POSSIBLE_DATE_REGEX.test(attributes) && !BLACK_LISTED_DATE_META_REGEX.test(attributes)) {

      // match exact 
      if(EXACT_DATE_META_REGEX.test(meta.getAttribute("name"))) {
        possibleDates[meta.getAttribute('content')] = 99;
        break;
      }


      if ( !possibleDates[ meta.getAttribute('content') ] )
        possibleDates[ meta.getAttribute('content') ] = 0;
      possibleDates[ meta.getAttribute('content') ]++;
    }
  }

  var sorted = [];
  for(var date in possibleDates) {
    sorted.push({date: tryParsingDate(date), count:possibleDates[date], raw: date, algorithm: "meta" });
  }
  sorted.sort( function(a,b){ return b.count - a.count; })

  return sorted.lenght == 0 ? null : sorted;
}


function extractDateWithTimeTags(document) {
  var tags = document.getElementsByTagName('time');
  var tag;
  var possibleDates = [];
  var possibleDate;
  for( var i = 0, len = tags._length; i < len; i++) {
    tag = tags[i];
    possibleDate = tryParsingDate( tag.getAttribute('datetime') );
    if (!possibleDate)
      possibleDate = dateish.parse(tag.getAttribute('datetime'))

    if (possibleDate)
      possibleDates.push( possibleDate );
  }

  // dedup dates 
  var map = {};
  var date;
  for(var i = 0; i < possibleDates.length; i++) {
    if(!possibleDates[i]) continue;
    date = possibleDates[i];
    if ( !map[ date ] )
      map[ date ] = 0;
    map[ date ]++;
  }

  var sorted = [];
  for(date in map) {
    sorted.push({ date: date, parsed: new moment(date), count: map[date], algorithm: "based on time tag" })
  }

  return sorted;

}



/* */
function extractPublishedDateBasedOnAuthor(authorNodes) {
  if(!authorNodes) return [];

  var publishedDate, possibleDate, possibleDates = [];
  for(var i = 0; i < authorNodes.length; i++) {
    possibleDates = possibleDates.concat( extractDateBasedOnAuthorNode( authorNodes[i] ) );
  }

  log(" Total Possible Dates Found based on Author: ".green, possibleDates.length);
  log(possibleDates);

  // dedup dates 
  var map = {};
  var date;
  for(var i = 0; i < possibleDates.length; i++) {
    if(!possibleDates[i]) continue;
    date = possibleDates[i].toString("YYYY-MM-DD");
    if ( !map[ date ] )
      map[ date ] = 0;
    map[ date ]++;
  }

  var sorted = [];
  for(date in map) {
    sorted.push({ date: date, parsed: new moment(date), count: map[date], algorithm: "based on author" })
  }

  // log("Sorted Date: ", sorted);

  return sorted[0];
}




function extractDateBasedOnAuthorNode(authorNode) {
  var parentNode = authorNode.parentNode;

  var possibleNodes = [];
  var possibleDates = [];
  var found = false;
  while( ! found && parentNode ) {
    var node, nodeValue;
    for(var i = 0, len = parentNode.childNodes._length; i < len; i++) {
      node = parentNode.childNodes[i];
      if(node.nodeType != NODE_TYPES.ELEMENT_NODE) continue;

      
      if ( isPossiblyDateNode(node) ) {
        nodeValue = readability.getInnerText(node).trim();
        log('Found a possible date node'.green, nodeValue);
        var date = tryParsingDate(nodeValue);

        if( !date && nodeValue.length < 50 ) {
          // log("Trying parsing with dateish", nodeValue)
          try {
            date = dateish.parse(nodeValue)  
          } catch (ex) {
            log('WTF Dateish'.red, ex)
          }
          
        }
          

        if( date ) 
          possibleDates.push(date);



        possibleDates = possibleDates.concat( DFSNodesForDate(node, nodeValue) );
        

        found = true;
      }
    }

    parentNode = parentNode.parentNode;
  }

  return possibleDates;

}

function possiblyContainsDateNode(parentNode) {
  var node;
  var result = false;
  for(var i = 0, len = parentNode.childNodes._length; i < len; i++) {
    node = parentNode.childNodes[i];
    if(node.nodeType != NODE_TYPES.ELEMENT_NODE) continue;
    var nodeValue = readability.getInnerText(node).trim();
    result = result || isPossiblyDateNode(node) || POSSIBLE_DATE_VALUE.test(nodeValue);
  }
  return result;
}

function isPossiblyDateNode(node) {
  var attributes = [ 
    node.getAttribute('id')
    ,node.getAttribute('class')
    ,node.getAttribute('name')
    ,node.getAttribute('rel')
  ].join(" ").trim();
  return POSSIBLE_DATE_REGEX.test(attributes);
}


function inspectNode(node) {
  var attributes = [ 
    node.tagName
    ,node.getAttribute('id')
    ,node.getAttribute('class')
    ,node.getAttribute('name')
    ,node.getAttribute('rel')
  ].join(" ").trim();
  return attributes;      
}


// return an array of Dates 
// by doing a Depth-first search
function DFSNodesForDate(node, possibleValue, level) {
  var found = [];
  var space = "";
  if(!level) level = 1;
  for(var i = 0; i < level; i++) {
    space += "  ";
  }

  var dates = {};

  // log(node.nodeValue);

  if ( node.nodeValue != null) {
    log("Inspecting current node first")
    var nodeValue = node.nodeValue.trim();
    if ( POSSIBLE_DATE_VALUE.test(nodeValue)) {
      log(space + "date candidate added".green, nodeValue);
      var date = tryParsingDate(nodeValue)
      if (date) found.push( date );
    }
  } else {
    var childNode;
    for (var i = 0, len = node.childNodes._length; i < len; i++) {
      childNode = node.childNodes[i];
      childContent = readability.getInnerText(childNode).trim();

      log( space + "content: ", childContent)

      if (POSSIBLE_DATE_VALUE.test(childContent) && childContent.length <= possibleValue.length ) {
        log( space + "looking into child node ", childNode.tagName);
        found = found.concat(DFSNodesForDate(childNode, childContent, level + 1));
      }
    }
  }

  return found;
}








exports.parse = function parse(theHtml, url, options, callback) {
  // backward compatibility: readability.parse(html, url, callback)
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }
  var defaultOptions = {
    profile: false,
    debug: false,
    removeReadabilityArtifacts: true,
    removeClassNames: true,
    logging: true,
    html5: false
  };
  options = Utils.extend({}, defaultOptions, options);
  
  var startTime = new Date().getTime();
  //dbg(html);

  var html = theHtml;
  // get rid of namespacing <html> that could throw jsdom offource:
  // https://github.com/tmpvar/jsdom/issues/621
  html = html.replace(/<html.*>/i, "<html>");

  html = html.replace(/<iframe.*?>.*?<\/iframe>/ig, '');

  // Turn all double br's into p's. Advanced from prepDocument to here
  // saves > 1 seconds for large pages.
  html = html.replace(readability.regexps.replaceBrs, '</p><p>').replace(readability.regexps.replaceFonts, '<$1span>');


  try {
    var docOptions = {
      url: url,
      // do not fetch or process any external resources
      features : {
        FetchExternalResources   : false,
        ProcessExternalResources : false
      }
    };

    function createDocWithHTMLParser() {
      var doc = jsdom.jsdom(html, null, docOptions);
      return doc;
    }


    var win;


    // function createDocWithHTML5() {
    //   var browser = jsdom.browserAugmentation(jsdom.defaultLevel, docOptions);
    //   var doc = new browser.HTMLDocument();
    //   var HTML5 = require('html5');
    //   var parser = new HTML5.Parser({document: doc});
    //   parser.parse(html);
    //   return doc;
    // }


    function createDocWithHTML5Parser() {
      log("Creating doc with HTML5 Parser ")
      // var HTML5 = require('html5');
      var window1 = jsdom.jsdom(null, null, {parser: HTML5}).createWindow();
      var parser = new HTML5.Parser({document: window1.document});
      parser.parse(html);
      var doc = window1.document;
      win = window1;
      return doc;
    }


    var doc = createDocWithHTMLParser();

    /* this leaks memory! */
    if (!doc.body) {
      dbg('empty body');
      if(options.html5)
        doc = createDocWithHTML5Parser();
    }
    /* */

    if (!doc.body) {
    //   dbg('doc.body is still null.');
      try {
        if( doc.parentWindow ) {
          doc.parentWindow.close();
          delete doc;
        }
      } catch(ex) {
        log("Error closing doc when doc.body is empty ");
        log(ex, ex.stack);
      }
        
      
      return callback({title: 'ERROR Unable to parse HTML.  doc.body is null', content: '', error: true});
    }

    dbg('---DOM created');


    if (!win) {
      win = doc.parentWindow;
    }
      


    readability.removeScripts(doc);
    readability.removeTags(doc, 'style');
    readability.removeTags(doc, 'iframe');
    readability.removeCommentNodes(doc);


    var images, publishedDate, author;
    
    images = extractImages(doc, url);
    
    
    var metaExtractionTime = new Date()
    var authorFromMeta = extractAuthorWithMetaData(doc);
    if (authorFromMeta.length > 0 && authorFromMeta[0].length > 0) {
      log("found author from meta")
      author = authorFromMeta[0];
    }


    if (!publishedDate) {
      var dateFromMeta = extractDateWithMetaData(doc);
      if (dateFromMeta.length > 0 ) {
        log("found date from meta")
        publishedDate = dateFromMeta[0];
      }
    }

    if (!publishedDate) {
      publishedDate = extractDateFromUrl(url);
    }

    if (!publishedDate) {
      var dateFromTimeTags = extractDateWithTimeTags(doc);
      if (dateFromTimeTags.length > 0 ) {
        log("found date from timetags")
        publishedDate = dateFromTimeTags[0];
      }
    }

    

    try {
      if(!author || (author && author.length == 0) ) {
        log("extract author bruteforce".red)
        author = extractAuthor(doc);
      }
      
      log("about to extract publishedDate".red)

      if(!publishedDate && author && author.nodes) {
        log("Extract Date Bruteforce".red)
        publishedDate = extractPublishedDateBasedOnAuthor(author.nodes);
      }
        

    } catch(ex) {
      log( "R ERROR".red, " parsing author or date ",ex);
      log( ex.stack );
    }

    // log(publishedDate);
    var metaExtractionTimeTaken = new Date() - metaExtractionTime;
    log("Extracting author and date taken:", metaExtractionTimeTaken, "ms");


    
    try {
      start(win, doc, options, function(html) {
        var time = new Date().getTime() - startTime;
        data = {
          title: document.title
          , content: html.toString()
          , images: images
          , time: time / 1000
          , inputLength: theHtml.length
        }

        if(author) data.author = author.author.replace(/^\s*By\s/i,'');
        
        if (publishedDate) {
          log( "HAS PUBLISEHD DATE".red, publishedDate )
          data.publishedDate = publishedDate;
          data.date = publishedDate.date || publishedDate;
        }
        // console.log(data);

        callback(data);
        
      });

    } catch(ex) {
      throw ex;
    } finally {
      log('Cleaning up'.yellow);
      delete doc;
      win.close();
      delete document;
      delete window;
      // if(doc.close)
      //   doc.close();
      delete win;
      
    }

  } catch(e) {
    //throw e;
    dbg('Error', e.message, e.stack);
    console.log(e.stack)
    callback({title: '', content: '', error: true});
  }
};

//jsdom tweaks
if (!jsdom.applyDocumentFeatures)
(function() {
  //hack for older versions of jsdom when features can't be disabled by API
  var core = jsdom.defaultLevel;
  //disable loading frames
  delete core.HTMLFrameElement.prototype.setAttribute;

  //disable script evaluation
  delete core.HTMLScriptElement.prototype.init;
})();

exports.sprintf = sprintf;


// exports.gc = function() {
//   try{
//     window.close();
//     delete document;
//     delete window;

//     win.close();
//     delete win;
//     delete doc;

//   } catch (ex) {
//     log(ex);
//   }
// }
