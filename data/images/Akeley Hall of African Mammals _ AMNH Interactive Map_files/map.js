/* global $, MeridianSDK, floorId, placemarkData, amenitiesTypes, placemarkAlias, langCode, bundle_prefix, api_path, mapTranslationStrings */
// first load and store all markers data from the cms
let map = '';
let hallExhibits = {};
let hallNames = {};
let searchResults = [];
let defaultPlacemark;
let clickedPlacemark;
let searchPushTimerId; // timer identifier
const searchTimerInterval = 1000; // 1s, time to wait when typing ends before searching and before pushing no result string to GTM
const clickedZoom = 0.3;
let request;
let pointerX;
let allowClick = false;
const dragSensivity = 7;

// some placemarks only live in meridian, must always be visible
const staticAmenities = ['stairs', 'elevator', 'escalator'];
// list of fields that populate toaster for placemarks
const specs = ['image', 'title', 'subtitle', 'description', 'body', 'tickets', 'showtimes'];
// floors don't have an ez node, must set their url alias manually
const floors = {
    6411484229795840: {
        alias: 'lower-level',
        label: mapTranslationStrings['floor-0'],
        class: 'floor-0',
    },
    5728962386853888: {
        alias: 'floor-1',
        label: mapTranslationStrings['floor-1'],
        class: 'floor-1',
    },
    5888391572881408: {
        alias: 'floor-2',
        label: mapTranslationStrings['floor-2'],
        class: 'floor-2',
    },
    5178931695058944: {
        alias: 'floor-3',
        label: mapTranslationStrings['floor-3'],
        class: 'floor-3',
    },
    5676735584534528: {
        alias: 'floor-4',
        label: mapTranslationStrings['floor-4'],
        class: 'floor-4',
    },
};
const langs = ['en', 'es', 'fr', 'pt'];

const blankImg = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
// "unreliable" meridian selectors (change with version updates)
const floorDialogClass = 'meridian-details-overlay';

// mutation observer to detect floor dialog addition to DOM params
const observerOptions = {
    attributes: false,
    childList: true,
    subtree: false,
};

// FUNCTIONS

function openModal() {
    let id = $(this).attr('id').split('-')[0];
    // close toaster modal for search (too busy)
    if (id === 'search') {
        closeModal('toaster');
    }
    $('#' + id + '-modal').removeClass('hide');
    // get visitor info data
    if (id === 'info') {
        // fetch data only once
        if (!$('#info-body').html()) {
            // add html to placeholder in tpl (only one possible page)
            $('#info-title').html(mapTranslationStrings['visitor-info']);
            $.getJSON(api_path + '/pages/visitor_info', (data) => {
                $('#info-body').html(data.page.data);
            });
        }
        // bring focus to close btn, except for search (go to input)
        $('#' + id + '-modal .close-btn').focus();
    } else if (id === 'search') {
        $('#search-input').focus();
    } else {
        $('#' + id + '-modal .close-btn').focus();
    }
}

function closeModal(id) {
    // certain modals need special close sequence
    if (id === 'toaster') {
        closeToaster(0);
    } else {
        if (id === 'lang') {
            // store the lang in case picker was dismissed
            storeLanguage(langCode);
        }
        $('#' + id + '-modal').addClass('hide');
        // return focus to modal trigger
        $('#' + id + '-btn').focus();
    }
}

function addSearchResults(data) {
    // update counter
    $('#results-counter').html(data.length + ' ' + mapTranslationStrings['results']);
    // reset results
    $('#results-wrapper .results-list').html('');
    data.forEach((result, idx) => {
        // use any image we can find, starting with square ones
        // not all placemarks have an image, use blank space by default
        let image = blankImg;
        let alias = '/square_325';
        if (result.hasOwnProperty('image_map') && result.image_map) {
            image = result.image_map + alias;
        } else if (result.hasOwnProperty('image_bio') && result.image_bio) {
            image = result.image_bio + alias;
        } else if (result.hasOwnProperty('image_card') && result.image_card) {
            image = result.image_card + alias;
        }
        let title = result.map_title;
        // short_title not available in all endpoints, but prefered here
        if (result.hasOwnProperty('short_title') && result.short_title) {
            title = result.short_title;
        }
        // crop title if too long either way (must be single line)
        // skip html chars in count, but also when cropping...(TO DO)
        title = stripTags(title).length > 25 ? title.substr(0, 25) + '...' : title;
        // type isn't meant to be displayed, subtype is (already uppercase)
        // only amenities have a search_subtype field (in main endpoint, not search)
        // search endpoint only returning subtype but matched to search_subtype (mostly empty)
        // use main types logic for now
        let type = '';
        if (result.hasOwnProperty('amenity_type_id')) {
            type = mapTranslationStrings['type-amenity'];
        } else if (result.type === 'special_event') {
            type = mapTranslationStrings['type-special-exhibition'];
        } else if (result.type === 'exhibit') {
            type = mapTranslationStrings['type-exhibit'];
        } else if (result.type === 'hall') {
            type = mapTranslationStrings['type-hall'];
        } else {
            type = result.type;
        }
        let label = type + ': ' + title;

        // Clone template and populate
        const template = document.getElementById('search-result-template');
        const clone = template.content.cloneNode(true);
        const button = clone.querySelector('.result-item');
        const img = clone.querySelector('img');
        const typeSpan = clone.querySelector('.type');
        const titleSpan = clone.querySelector('.title');

        button.setAttribute('data-idx', idx);
        button.setAttribute('aria-label', label);
        img.src = image;
        typeSpan.textContent = type;
        titleSpan.innerHTML = title;

        $('#results-wrapper .results-list').append(clone);
    });
}

function search() {
    let query = $('#search-input').val();
    // abort any existing search api call
    if (request) {
        request.abort();
    }
    if (query.length) {
        // show that results are beong fetched
        $('#results-counter').html(mapTranslationStrings['searching']);
        // using wildcard (*) to return more results (fuzzy match (~) is too slow)
        request = $.getJSON(api_path + '/search?query=' + query + '* OR ' + query, (data) => {
            // clear old results
            $('#results-wrapper .results-list').html('');
            // clear the search countdown every time we perform the ajax call
            clearTimeout(searchPushTimerId);
            // store data to pass it to link clicks
            searchResults = data;
            if (data.length) {
                addSearchResults(data);
                // add placemark trigger
                $('.result-item').on('click', function () {
                    // mimic data format passed by direct placemark clicks
                    let edata = {
                        data: {
                            data: searchResults[$(this).data('idx')],
                        },
                    };
                    $('#search-modal').addClass('hide');
                    openToaster(edata);
                });
            } else {
                $('#results-counter').html(mapTranslationStrings['no-results']);
                $('#results-wrapper .results-list').html('');
                // when the search results are empty, we wait one more sec and push to GTM
                searchPushTimerId = setTimeout(() => {
                    pushToGTM(
                        'interactionEvent', // event
                        'interactive map no search results', // category
                        'string: ' + query, // action
                        'no results' // label
                    );
                }, searchTimerInterval);
            }
        });
    } else {
        // no text means no results
        $('#results-counter').html('');
        $('#results-wrapper .results-list').html('');
    }
}

function mapReady() {
    map.update({
        shouldMapPanZoom: () => true,
    });
    // restore meridian zoom buttons
    $('.meridian-zoom-controls').removeClass('hide');
    // show floor picker btn
    $('.meridian-floor-control').removeClass('hide');
    // show search btn now that map is ready
    $('.nav-btn').removeClass('hide');
}

function mapLoading() {
    map.update({
        shouldMapPanZoom: () => false,
    });
    // hide meridian zoom buttons
    $('.meridian-zoom-controls').addClass('hide');
    // disable floor picker btn while loading
    $('.meridian-floor-control').addClass('hide');
    // hide search btn while map is loading
    $('.nav-btn').addClass('hide');
}

function loadMap() {
    // See https://arubanetworks.github.io/meridian-web-sdk/
    // for complete Meridian Web SDK documentation.
    MeridianSDK.init({
        api: new MeridianSDK.API({
            environment: 'production',
            token: 'e0a8b3c25a06a9cdf13b9df658baeae8e30c1e01',
            language: langCode,
        }),
    });
    const root = document.querySelector('#meridian-map');
    map = MeridianSDK.createMap(root, {
        locationID: '2216128',
        floorID: floorId,
        height: '100%',
        loadTags: false,
        showTagsControl: false,
        showSearchControl: false,
        minZoomLevel: 0.13,
        maxZoomLevel: 0.9,
        // disable zoom while map is loading (breaks placemark overrides otherwise)
        shouldMapPanZoom: () => false,
        placemarks: {
            // hide labels for now until we override them
            labelMode: 'zoom',
        },
        onPlacemarkClick: (placemark, event) => {
            event.preventDefault();
        },
        onPlacemarksUpdate: (placemarks) => {
            // map is ready, override markers
            // this is triggered on floor change too
            customizePlacemarks(placemarks);
        },
        onFloorsUpdate: (floors) => {
            // disable floor picker while loading
            mapLoading();
        },
        onFloorChange: (floor) => {
            mapLoading();
            // update floor id already so that toaster updates url fast
            floorId = floor.id;
            closeToaster();
            // restore placemark update to trigger it again (floor specific)
            map.update({
                onPlacemarksUpdate: (placemarks) => {
                    customizePlacemarks(placemarks);
                },
            });
        },
        onMapClick: () => {
            closeToaster();
        },
    });
    mapLoading();
    console.info('meridianSDK version:', MeridianSDK.version);
    // start listening for floor control modal (added to dom only when clicked)
    observer.observe($('#meridian-map .meridian-map-container').get(0), observerOptions);
}

function customizePlacemarks(placemarks) {
    // apply missing accessibility labels to meridian buttons
    $('.meridian-zoom-button-in').attr('aria-label', mapTranslationStrings['zoom-in']);
    $('.meridian-zoom-button-out').attr('aria-label', mapTranslationStrings['zoom-out']);
    $('.meridian-floor-control').attr(
        'aria-label',
        mapTranslationStrings['change-floor'] +
            '. ' +
            mapTranslationStrings['current-floor'] +
            ' ' +
            floors[floorId].label
    );
    // use floor label as main header
    $('.meridian-floor-label').attr('role', 'header').attr('aria-level', '1');
    // remove all placemark labels from meridian
    // will add custom ones from cms instead
    // also hide all cms placemarks (static amenities are in meridian only)
    // will reveal the visible one in the cms
    // idea: load only static placemarks from meridian and load rest from cms?
    $('.meridian-placemark').addClass('hide');
    for (const placemark of placemarks.allPlacemarks) {
        placemark.name = '';
        if (staticAmenities.indexOf(placemark.type) > -1) {
            let id = placemark.id.split('_')[1];
            let $staticPlacemark = $(
                '.meridian-placemark-icon[data-meridian-placemark-id="' + id + '"]'
            );
            // apply lowest z-index to put custom on top if overlap
            $staticPlacemark.parent().css('z-index', '1');
            // add accessibility labels
            $staticPlacemark.attr('role', 'presentation');
            $staticPlacemark.prop('disabled', true);
            $staticPlacemark.parent().removeClass('hide');
        }
    }
    // reset hall-exhibit data from previous floor
    hallExhibits = {};
    // reset last clicked placemark
    clickedPlacemark = '';
    // remove medirian "label" divs from screen readers
    $('.meridian-label').attr('aria-hidden', 'true');
    $.each(placemarkData, (key, data) => {
        let floor = data.location_placemark.split('_')[0];
        let $placemark = getPlacemarkTarget(data);
        // if this marker is in current viewed floor, customize it
        if (floor === floorId && $placemark.length) {
            // add z-index for placemarks to overlap properly
            // must be done in js to target parent
            // photo (4) > hall (3) > amenities (2) > static (1)
            // apply different treatments for custom placemarks
            let image = '';
            let customClass = 'custom-placemark';
            if (data.hasOwnProperty('amenity_type_id')) {
                $placemark.parent().css('z-index', '2');
                // amenities use the type icon instead
                for (var type of amenitiesTypes) {
                    if (type.id === data.amenity_type_id) {
                        image = type.icon_image;
                        customClass = image ? 'custom-placemark-icon' : customClass;
                        // add a class to filter them by type
                        customClass = customClass + ' type-amenity';
                        break;
                    }
                }
                // reveal if filter is selected
                if ($('#amenities-btn').hasClass('active')) {
                    $placemark.parent().removeClass('hide');
                }
            } else if (['exhibit', 'special_event'].indexOf(data.type) > -1) {
                $placemark.parent().css('z-index', '4');
                // only (special) exhibits get a photo icon
                image = data.image_map + '/square_325';
                customClass = image ? 'custom-placemark-photo' : customClass;
                // add a class to filter them by type
                customClass = customClass + '  type-' + data.type;
                // store exhibit-hall relation now as it's avaiable
                // relation is in exhibits but it's needed in hall toaster
                if (data.type === 'exhibit') {
                    if (data.hall_id) {
                        if (hallExhibits.hasOwnProperty(data.hall_id)) {
                            hallExhibits[data.hall_id].push(data);
                        } else {
                            hallExhibits[data.hall_id] = [data];
                        }
                    }
                }
                // reveal if filter is selected or is special exhibition (always visible)
                if ($('#exhibits-btn').hasClass('active') || data.type == 'special_event') {
                    $placemark.parent().removeClass('hide');
                }
            } else {
                // it has to be a hall
                customClass = customClass + ' type-hall';
                $placemark.parent().css('z-index', '3');
                // reveal if filter is selected
                if ($('#halls-btn').hasClass('active')) {
                    $placemark.parent().removeClass('hide');
                }
                // store hall (short) names to use in location for exhibits toaster
                hallNames[data.id] = data.short_title;
            }
            if (image) {
                // add image inside a new span element (button pin share requirement)
                $placemark.append('<span></span>');
                $placemark.children().css({
                    'background-image': 'url(' + image + ')',
                });
            }
            // apply a custom class no matter what to know it's clickable
            $placemark.addClass(customClass);
            // use cms marker title for div "labels", except for amenities
            if (data.map_title) {
                // add (lowercase) title as aria-label to all buttons
                let cleanTitle = stripTags(data.map_title);
                $placemark.attr('aria-label', cleanTitle.toLowerCase());
                if (!data.hasOwnProperty('amenity_type_id')) {
                    // update right away but also store value in web sdk data
                    // $placemark.siblings('.meridian-label').text(data.map_title);
                    for (const placemark of placemarks.allPlacemarks) {
                        if (placemark.id == data.location_placemark) {
                            // override meridian data directly as it gets called again when zooming
                            // html label isn't supported in web sdk
                            // if the map_title has an opening parenthesis, add line break before the parenthesis character
                            if (cleanTitle.includes('(')) {
                                cleanTitle = cleanTitle.replace('(', '\n(');
                            }
                            placemark.name = cleanTitle;
                            break;
                        }
                    }
                }
            }
            // add alias as data to use it in GTM (same across all languages)
            $placemark.attr('data-alias', localAlias(data.url_alias));
            // pass the cms data of that placemark to populate the toaster
            $placemark.on(
                'click',
                {
                    data: data,
                },
                openToaster
            );
            // check if placemark name from url is a match
            if (placemarkAlias != '' && placemarkAlias == localAlias(data.url_alias)) {
                // mimic data format passed by direct placemark clicks
                defaultPlacemark = {
                    data: {
                        data: data,
                    },
                };
                // can only happens once, else returning to that floor will trigger it
                placemarkAlias = '';
            }
        }
    });
    // reveal placemark labels now
    // disable placemarkUpdate now that it's been called
    map.update({
        onPlacemarksUpdate: (placemarks) => {},
        placemarks: {
            labelMode: 'zoom',
        },
    });
    mapReady();
    // if coming from search on a different floor (or direct url), then show that placemark
    if (defaultPlacemark) {
        openToaster(defaultPlacemark);
    } else {
        // still need to update floor url on language picker
        updateUrl('');
        updateMeta();
    }
    checkLanguage();
}

function getPlacemarkTarget(data) {
    let id = data.location_placemark.split('_')[1];
    return $('.meridian-placemark-icon[data-meridian-placemark-id="' + id + '"]');
}

function initCarousel(selector) {
    $(selector).slick({
        infinite: false,
        arrows: false,
        speed: 100,
        cssEase: 'ease-in-out',
        centerMode: false,
        waitForAnimate: false,
        swipeToSlide: true,
        slidesToShow: 2.8,
        focusOnSelect: false,
        responsive: [
            {
                breakpoint: 620,
                settings: {
                    slidesToShow: 2.2,
                },
            },
            {
                breakpoint: 480,
                settings: {
                    slidesToShow: 1.8,
                },
            },
            {
                breakpoint: 360,
                settings: {
                    slidesToShow: 1.2,
                },
            },
        ],
    });
}

function showHall(data) {
    // data is in exhibits, we already stored that when looping over all data
    if (hallExhibits[data.id]) {
        // reduce hall top image to save space for carousel
        $('#toaster-modal').addClass('hall-modal');
        hallExhibits[data.id].forEach((exhibit, idx) => {
            // Clone template and populate
            const template = document.getElementById('carousel-item-template');
            const clone = template.content.cloneNode(true);
            const button = clone.querySelector('.exhibit');
            const inner = clone.querySelector('.inner');

            button.style.backgroundImage = 'url(' + exhibit.image_map + '/square_325)';
            button.setAttribute('data-alias', localAlias(exhibit.url_alias));
            button.setAttribute('data-idx', idx);
            inner.textContent = exhibit.title;

            // add data-alias to track GTM events across all languages
            $('#toaster-title').attr('data-alias', localAlias(data.url_alias));

            $('#carousel').append(clone);
        });
        initCarousel('#carousel');
        // add placemark click (mobile carousel swipe works, but triggers click on desktop)
        $('.exhibit').on('click', function (e) {
            if (allowClick) {
                let edata = {
                    data: {
                        data: hallExhibits[data.id][$(this).data('idx')],
                    },
                };
                openToaster(edata);
            } else {
                e.preventDefault();
            }
        });
        if (isTouchDevice()) {
            allowClick = true;
        } else {
            allowClick = false;
            $('.exhibit').on('mousedown', (e) => {
                pointerX = e.pageX;
            });
            $('.exhibit').on('mouseup', function (e) {
                let pointerShift = Math.abs(pointerX - e.pageX);
                if (pointerShift < dragSensivity) {
                    allowClick = true;
                    // allow gtm clicks
                    $(this).removeClass('no-gtm-click');
                } else {
                    allowClick = false;
                    // also need to add class to skip GTM trigger
                    $(this).addClass('no-gtm-click');
                }
            });
        }
        // add keyboard control to
        $('.exhibit').on('keypress', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                let edata = {
                    data: {
                        data: hallExhibits[data.id][$(this).data('idx')],
                    },
                };
                openToaster(edata);
            }
        });
        $('.exhibits').removeClass('hide');
    }
}

function showSpecialEvent(data) {
    // check if open
    const date_start = new Date(data.date_start);
    const date_end = new Date(data.date_end);
    const date_now = new Date();
    if (date_now > date_start && date_now < date_end) {
        $('.status').html(mapTranslationStrings['now-open']).removeClass('hide');
    } else {
        $('.status').html(mapTranslationStrings['closed']).removeClass('hide');
    }
    // display subtype above title (special exhibits only)
    showSpec(data, 'subtype');
}

function revealToaster() {
    // make it visible to screen readers
    $('#toaster-modal').removeClass('hide');
    // changing floor adds inline display none(?) fix it
    $('#toaster-modal').css({
        display: 'block',
        overflowY: 'hidden',
    });
    const infoHeight = $('#toaster-modal>.inner').get(0).scrollHeight;
    $.when(
        $('#toaster-modal').animate(
            {
                height: infoHeight,
            },
            {
                duration: 300,
                queue: false,
            }
        ),
        $('#meridian-map').animate(
            {
                bottom: infoHeight,
            },
            {
                duration: 300,
                queue: false,
            }
        )
    ).done(() => {
        $('#toaster-modal').css({
            height: 'auto',
            overflowY: 'auto',
        });
        // center map in case placemark is under toaster
        // "true" toaster height doesn't seem to be accurate until carousel is visible...
        // get height again to center map properly
        centerMap();
        // set focus to close btn
        $('#toaster-modal .close-btn').focus();
    });
}

function openToaster(e) {
    // parameters received from function are stored in e.data
    let data = e.data.data;
    // check if placemark is on current floor (not always from search)
    let floor = data.location_placemark.split('_')[0];
    if (floor !== floorId) {
        // must change floor first (init map again for now)
        // but first store that placemark to open it once map is ready again
        // mimic data format passed by direct placemark clicks
        defaultPlacemark = e;
        // update floor id already so that toaster updates url fast
        floorId = floor;
        // clear clickedPlacemark to avoid focus/zoom error when closing map
        // clickedPlacemark will be set once toaster opens
        clickedPlacemark = '';
        closeToaster();
        map.destroy();
        loadMap();
    } else {
        let $placemark = getPlacemarkTarget(data);
        $('.meridian-placemark').removeClass('active');
        // adding the active class will trigger css animation on placemark
        // placemark could be hidden by filters, so reveal it
        $placemark.parent().addClass('active').removeClass('hide');
        // reset toaster content
        $('.spec:not(.exhibits)').html('');
        // remove carousel, if any (must be hidden)
        if ($('#carousel').hasClass('slick-initialized')) {
            $('#carousel').slick('unslick');
        }
        $('#carousel').html('');
        $('.spec').addClass('hide');
        // reset modal type
        $('#toaster-modal').removeClass('hall-modal');
        // add custom toaster content found
        for (const spec of specs) {
            showSpec(data, spec);
        }
        // add location (floor)
        let location = floors[floorId].label;
        // append hall name, if any (exhibits only)
        if (data.hall_id) location = hallNames[data.hall_id] + ', ' + location;
        $('.location').html(location).removeClass('hide');
        if (data.type === 'special_event') {
            showSpecialEvent(data);
        } else if (data.type === 'hall') {
            showHall(data);
        }
        $('#toaster-modal .close-btn').attr(
            'aria-label',
            mapTranslationStrings['close'] +
                ' ' +
                $('#toaster-title').text() +
                ' ' +
                mapTranslationStrings['dialog']
        );
        revealToaster();
        updateUrl(localAlias(data.url_alias));
        updateMeta(data);
        // reset defaultPlacemark
        defaultPlacemark = '';
        // store currentPlacemark to return focus when closed
        clickedPlacemark = data;
    }
}

function closeToaster(speed = 300) {
    $('.meridian-placemark').removeClass('active');
    $.when(
        $('#toaster-modal').animate(
            {
                height: '0',
            },
            {
                duration: speed,
                queue: false,
            }
        ),
        $('#meridian-map').animate(
            {
                bottom: '0',
            },
            {
                duration: speed,
                queue: false,
            }
        )
    ).done(() => {
        // hide it from screen readers
        $('#toaster-modal').addClass('hide');
        // recenter map to fix boundaries
        centerMap();
        // return focus to last placemark, if any (not when changing floor)
        if (clickedPlacemark && clickedPlacemark !== '') {
            getPlacemarkTarget(clickedPlacemark).focus();
        }
    });
    updateUrl('');
    updateMeta();
}

function showSpec(data, spec) {
    if (spec === 'image') {
        let image = '';
        // use any image we can find, starting with wide ones, card being default
        let alias = '/wideexact_1230';
        if (data.hasOwnProperty('image_card') && data.image_card) {
            image = data.image_card + alias;
        } else if (data.hasOwnProperty('image_wideangle') && data.image_wideangle) {
            image = data.image_wideangle + alias;
        } else if (data.hasOwnProperty('image_bio') && data.image_bio) {
            image = data.image_bio + alias;
        } else if (data.hasOwnProperty('image_map') && data.image_map) {
            image = data.image_map + alias;
        }
        if (image) {
            $('#toaster-modal').removeClass('no-image');
            $('#toaster-image')
                .css('background-image', 'url(' + image + ')')
                .removeClass('hide');
        } else {
            // TO DO: use icon if no image found
            $('#toaster-modal').addClass('no-image');
        }
    } else if (data[spec]) {
        $('.spec.' + spec)
            .html(data[spec])
            .removeClass('hide');
    }
}

function updateUrl(alias) {
    // even if no placemark data, still need to update floor
    let urlNoLang = '/' + bundle_prefix + '/' + floors[floorId].alias;
    if (alias) {
        urlNoLang = urlNoLang + '/' + alias;
    }
    // add floor level helper class to main maridian-map wrapper to add specific background-color to placemarks
    $('#meridian-map').removeClass('floor-0 floor-1 floor-2 floor-3 floor-4');
    $('#meridian-map').addClass(floors[floorId].class);
    // update url (replace url to do not fill history)
    let uri = getLangPrefix(langCode) + urlNoLang;
    history.replaceState({}, '', uri);
    // also update url in metas
    document.querySelector('meta[property="og:url"]').content = 'https://www.amnh.org' + uri;
    // add active floor url to language links
    for (var lang of langs) {
        $('#' + lang + '-btn').attr('href', getLangPrefix(lang) + urlNoLang);
    }
}

// this function helps but most social share links pull from original dom, js is ignored
// same must be done in twig
function updateMeta(data = false) {
    const suffix = ' | AMNH ' + mapTranslationStrings['interactive-map'];
    let title = data ? (data.short_title ? data.short_title : data.title) : floors[floorId].label;
    // remove html tags for the page title
    document.title = stripTags(title) + suffix;
    // og has site_name and type tags, so don't append suffix
    document.querySelector('meta[property="og:title"]').content = title;
    // twitter doesn't
    document.querySelector('meta[name="twitter:title"]').content = title + suffix;
    // update social image
    if (data && data.hasOwnProperty('image_card') && data.image_card) {
        document.querySelector('meta[property="og:image"]').content =
            data.image_card + '/facebookshare_1200';
        document.querySelector('meta[name="twitter:image"]').content =
            data.image_card + '/twittershare_1024';
    } else {
        document.querySelector('meta[property="og:image"]').content = defaultImage;
        document.querySelector('meta[name="twitter:image"]').content = defaultImage;
    }
}

function getLangPrefix(lang) {
    return lang === 'en' ? '' : '/' + lang;
}

function checkLanguage() {
    // now that map is ready and url has been parsed, update & reveal language picker
    // check if language has been selected or differs from url, else show them
    const storedLang = localStorage.getItem('amnh-interactive-map-lang');
    if (!storedLang || storedLang !== langCode) {
        $('#lang-modal').removeClass('hide');
    }
}

function storeLanguage(lang) {
    localStorage.setItem('amnh-interactive-map-lang', lang);
}

function stripTags(html) {
    return html.replace(/(<([^>]+)>)/gi, '');
}

function localAlias(alias) {
    // the whole backend absolute path object alias is passed, we only want the placemark alias
    return alias.split('/').pop();
}

// all 4 variables are strings
function pushToGTM(eventName, category, action, label) {
    if (typeof dataLayer !== 'undefined' && eventName && category && action) {
        if (label) {
            dataLayer.push({
                event: eventName,
                eventCategory: category,
                eventAction: action,
                eventLabel: label,
            });
        }
    }
}

// utility debounce function to limit search calls
function debounce(func, timeout) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            func.apply(this, args);
        }, timeout);
    };
}

function isTouchDevice() {
    return (
        'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0
    );
}

// recenter map if screen size changes (as carousel has breakpoints)
$(window).resize(centerMap);

/**
 * Adjusts the interactive iframe scale and container height
 */
function centerMap() {
    // only change map container size if modal is open
    if (!$('#toaster-modal').hasClass('hide')) {
        infoHeight = $('#toaster-modal>.inner').get(0).scrollHeight;
        $('#meridian-map').css('bottom', infoHeight);
    }
    // only center if a placemark was clicked
    if (clickedPlacemark) {
        map.zoomToPoint({
            x: clickedPlacemark.location_x,
            y: clickedPlacemark.location_y,
            scale: clickedZoom,
        });
    }
}

// BUTTONS

// enable lang, search, info btns
$('.nav-btn').on('click', openModal);
// modal close btns (and alpha overlays)
$('#toaster-modal .close-btn').on('click', () => {
    closeModal('toaster');
});
$('#info-modal .close-btn').on('click', () => {
    closeModal('info');
});
$('#search-modal .close-btn, #search-modal .modal-alpha').on('click', () => {
    closeModal('search');
});
$('#lang-modal .close-btn, #lang-modal .modal-alpha').on('click', () => {
    closeModal('lang');
});

// language picker
$('.lang-btn:not(".active")').on('click', function (e) {
    // delay language links to store selected language first
    e.preventDefault();
    let lang = $(this).attr('id').split('-')[0];
    storeLanguage(lang);
    location.href = $(this).attr('href');
});

// use url language to set active and disable its button
$('#' + langCode + '-btn')
    .off('click')
    .on('click', (e) => {
        e.preventDefault();
        closeModal('lang');
    });

$('.filter').on('click', function () {
    $(this).toggleClass('active');
    // some "hidden" placemarks could be revealed by search or halls
    if ($(this).hasClass('active')) {
        if ($(this).data('type') == 'exhibit') {
            $('.type-exhibit').parent().removeClass('hide');
        } else {
            $('.type-' + $(this).data('type'))
                .parent()
                .removeClass('hide');
        }
        // update sr state
        $(this).attr('aria-pressed', true);
    } else {
        if ($(this).data('type') == 'exhibit') {
            $('.type-exhibit').parent().addClass('hide');
        } else {
            $('.type-' + $(this).data('type'))
                .parent()
                .addClass('hide');
        }
        $(this).attr('aria-pressed', false);
    }
});

// LISTENERS

// input event is better than keyup as it works when text is cleared using (x) btn
$('#search-input').on('input', debounce(search, searchTimerInterval));

// allow any modal to be closed with esc key
$(document).on('keyup', (e) => {
    if (e.key === 'Escape') {
        if (!$('#toaster-modal').hasClass('hide')) closeToaster();
        if (!$('#toaster-modal').hasClass('hide')) closeSearch();
        if (!$('#info-modal').hasClass('hide')) closeVisitorInfo();
        // not sure how to apply that to the floor picker dialog
        // if ($('.'+floorDialogClass).length)
    }
});

// set focus trap on toaster
$('#toaster-modal .focus-trap-start').on('focus', () => {
    // move focus to last element of the dialog, if any
    // can only be last element of carousel, else stay on close btn
    if ($('#carousel .slick-slide').length) {
        $('#toaster-modal .slick-slide').last().focus();
    } else {
        $('#toaster-modal .close-btn').focus();
    }
});
$('#toaster-modal .focus-trap-end').on('focus', () => {
    // move focus back to close btn
    $('#toaster-modal .close-btn').focus();
});

// set focus trap on modals
// info: go back to close btn (nowhere else to go, links but added on the fly)
$('#info-modal .focus-trap-start, #info-modal .focus-trap-end').on('focus', () => {
    $('#info-modal .close-btn').focus();
});
// lang: go back to close btn or last language btn
$('#lang-modal .focus-trap-start').on('focus', () => {
    $('#lang-wrapper .lang-btn').last().focus();
});
$('#lang-modal .focus-trap-end').on('focus', () => {
    // move focus back to close btn
    $('#lang-modal .close-btn').focus();
});
// search: toggle between input and close btn, or last search result item
$('#search-modal .focus-trap-start').on('focus', () => {
    // move focus to last search result, or input field if none
    if ($('#results-wrapper .result-item').length) {
        $('#results-wrapper .result-item').last().focus();
    } else {
        $('#search-input').focus();
    }
});
$('#search-modal .focus-trap-end').on('focus', () => {
    // move focus back to close btn
    $('#search-modal .close-btn').focus();
});

// floor picker: not in dom at load, added via js on click
$('#meridian-map').on('focus', '.' + floorDialogClass + ' .focus-trap-start', () => {
    // move focus to last floor
    $('button[data-testid="meridian--private--floor"]').last().focus();
});
$('#meridian-map').on('focus', '.' + floorDialogClass + ' .focus-trap-end', () => {
    // move focus back to close btn
    $('button[data-testid="meridian--private--close-overlay"]').focus();
});

// hide filters when floor dialog is open (no better solution for now)
// add accessibility to poor meridian html
// also add identifying classes to floor picker for GTM
// observer will start once map is ready
const observer = new MutationObserver((mutations) => {
    // look through all mutations that just occured
    $.each(mutations, (i, mutation) => {
        if ($(mutation.addedNodes).hasClass(floorDialogClass)) {
            // make room
            closeToaster();
            $('#filters').addClass('hide');
            // apply dialog setup to floor popup (as it comes before floor selector btn in html)
            // not a very reliable class...
            $('.' + floorDialogClass).attr('role', 'dialog');
            $('.' + floorDialogClass).attr('aria-modal', 'true');
            $('.' + floorDialogClass).attr('aria-label', mapTranslationStrings['change-floor']);
            // move focus to close button (also add a label)
            $('button[data-testid="meridian--private--close-overlay"]')
                .attr('aria-label', mapTranslationStrings['close-change-floor'])
                .focus();
            // add focus traps
            $('.' + floorDialogClass).prepend(
                '<span class="focus-trap-start" tabindex="0" aria-hidden="true"></span>'
            );
            $('.' + floorDialogClass).append(
                '<span class="focus-trap-end" tabindex="0" aria-hidden="true"></span>'
            );
            // add floor ID for GTM
            // meridian floor buttons have testid="meridian--private--floor"
            // Except for current floor has a different testid="meridian--private--current-floor"
            $('.' + floorDialogClass + ' button[data-testid$="-floor"]').each(function (index) {
                $(this).attr('id', Object.values(floors)[index].alias);
                if ($(this).data('testid') == 'meridian--private--current-floor') {
                    $(this).attr(
                        'aria-label',
                        Object.values(floors)[index].label + ' ' + mapTranslationStrings['selected']
                    );
                }
            });
        } else {
            $('#filters').removeClass('hide');
        }
    });
});

$(() => {
    loadMap();
});
