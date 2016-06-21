const GdPrivate = imports.gi.GdPrivate;
const Gdk = imports.gi.Gdk;
const Gtk = imports.gi.Gtk;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Tweener = imports.tweener.tweener;

const Application = imports.application;
const ErrorBox = imports.errorBox;
const Searchbar = imports.searchbar;

const Preview = new Lang.Class({
    Name: 'Preview',
    Extends: Gtk.Stack,

    _init: function(overlay) {
        this._lastSearch = '';
        this.overlay = overlay;

        this.parent({ homogeneous: true,
                      transition_type: Gtk.StackTransitionType.CROSSFADE });

        let findPrev = Application.application.lookup_action('find-prev');
        let findPrevId = findPrev.connect('activate', Lang.bind(this, this.findPrev));

        let findNext = Application.application.lookup_action('find-next');
        let findNextId = findNext.connect('activate', Lang.bind(this, this.findNext));

        this._errorBox = new ErrorBox.ErrorBox();
        this.add_named(this._errorBox, 'error');

        this.view = this.createView();
        this.add_named(this.view, 'view');
        this.set_visible_child_full('view', Gtk.StackTransitionType.NONE);

        this.navControls = this.createNavControls();
        this.show_all();

        this.connect('destroy', Lang.bind(this, function() {
            findPrev.disconnect(findPrevId);
            findNext.disconnect(findNextId);
        }));
    },

    createNavControls: function() {
        return new PreviewNavControls(this, this.overlay);
    },

    createView: function() {
        throw(new Error('Not implemented'));
    },

    setError: function(primary, secondary) {
        this._errorBox.update(primary, secondary);
        this.set_visible_child_name('error');
    },

    goPrev: function() {
        throw (new Error('Not implemented'));
    },

    goNext: function() {
        throw (new Error('Not implemented'));
    },

    get hasPages() {
        return false;
    },

    get page() {
        return 0;
    },

    get numPages() {
        return 0;
    },

    search: function(str) {
        this._lastSearch = str;
    },

    get lastSearch() {
        return this._lastSearch;
    },

    findPrev: function() {
        throw (new Error('Not implemented'));
    },

    findNext: function() {
        throw (new Error('Not implemented'));
    }
});

const _AUTO_HIDE_TIMEOUT = 2;
const PREVIEW_NAVBAR_MARGIN = 30;

const PreviewNavControls = new Lang.Class({
    Name: 'PreviewNavControls',

    _init: function(preview, overlay) {
        this.preview = preview;
        this._overlay = overlay;

        this._visible = false;
        this._visibleInternal = false;
        this._pageChangedId = 0;
        this._autoHideId = 0;
        this._motionId = 0;

        this.bar_widget = this.createBarWidget();
        if (this.bar_widget) {
            this.bar_widget.get_style_context().add_class('osd');
            this._overlay.add_overlay(this.bar_widget);
            this.bar_widget.connect('notify::hover', Lang.bind(this, function() {
                if (this.bar_widget.hover)
                    this._onEnterNotify();
                else
                    this._onLeaveNotify();
            }));
        }

        this.prev_widget = new Gtk.Button({ image: new Gtk.Image ({ icon_name: 'go-previous-symbolic',
                                                                    pixel_size: 16 }),
                                            margin_start: PREVIEW_NAVBAR_MARGIN,
                                            margin_end: PREVIEW_NAVBAR_MARGIN,
                                            halign: Gtk.Align.START,
                                            valign: Gtk.Align.CENTER });
        this.prev_widget.get_style_context().add_class('osd');
        this._overlay.add_overlay(this.prev_widget);
        this.prev_widget.connect('clicked', Lang.bind(this, this._onPrevClicked));
        this.prev_widget.connect('enter-notify-event', Lang.bind(this, this._onEnterNotify));
        this.prev_widget.connect('leave-notify-event', Lang.bind(this, this._onLeaveNotify));

        this.next_widget = new Gtk.Button({ image: new Gtk.Image ({ icon_name: 'go-next-symbolic',
                                                                    pixel_size: 16 }),
                                            margin_start: PREVIEW_NAVBAR_MARGIN,
                                            margin_end: PREVIEW_NAVBAR_MARGIN,
                                            halign: Gtk.Align.END,
                                            valign: Gtk.Align.CENTER });
        this.next_widget.get_style_context().add_class('osd');
        this._overlay.add_overlay(this.next_widget);
        this.next_widget.connect('clicked', Lang.bind(this, this._onNextClicked));
        this.next_widget.connect('enter-notify-event', Lang.bind(this, this._onEnterNotify));
        this.next_widget.connect('leave-notify-event', Lang.bind(this, this._onLeaveNotify));

        this._overlay.connect('motion-notify-event', Lang.bind(this, this._onMotion));

        this._tapGesture = new Gtk.GestureMultiPress({ propagation_phase: Gtk.PropagationPhase.CAPTURE,
                                                       touch_only: true,
                                                       widget: this.preview.view });
        this._tapGesture.connect('released', Lang.bind(this, this._onMultiPressReleased));
        this._tapGesture.connect('stopped', Lang.bind(this, this._onMultiPressStopped));
    },

    createBarWidget: function() {
        return null;
    },

    _onEnterNotify: function() {
        this._unqueueAutoHide();
        return false;
    },

    _onLeaveNotify: function() {
        this._queueAutoHide();
        return false;
    },

    _motionTimeout: function() {
        this._motionId = 0;
        this._visibleInternal = true;
        this._updateVisibility();
        if (this.bar_widget && !this.bar_widget.hover)
            this._queueAutoHide();
        return false;
    },

    _onMotion: function(widget, event) {
        if (this._motionId != 0)
            return false;

        let device = event.get_source_device();
        if (device.input_source == Gdk.InputSource.TOUCHSCREEN)
            return false;

        this._motionId = Mainloop.idle_add(Lang.bind(this, this._motionTimeout));
        return false;
    },

    _onMultiPressReleased: function() {
        this._tapGesture.set_state(Gtk.EventSequenceState.CLAIMED);
        this._visibleInternal = !this._visibleInternal;
        this._unqueueAutoHide();
        this._updateVisibility();
    },

    _onMultiPressStopped: function() {
        this._tapGesture.set_state(Gtk.EventSequenceState.DENIED);
    },

    _onPrevClicked: function() {
        this.preview.goPrev();
    },

    _onNextClicked: function() {
        this.preview.goNext();
    },

    _autoHide: function() {
        this._autoHideId = 0;
        this._visibleInternal = false;
        this._updateVisibility();
        return false;
    },

    _unqueueAutoHide: function() {
        if (this._autoHideId == 0)
            return;

        Mainloop.source_remove(this._autoHideId);
        this._autoHideId = 0;
    },

    _queueAutoHide: function() {
        this._unqueueAutoHide();
        this._autoHideId = Mainloop.timeout_add_seconds(_AUTO_HIDE_TIMEOUT, Lang.bind(this, this._autoHide));
    },

    _updateVisibility: function() {
        let currentPage = this.preview.page;
        let numPages = this.preview.numPages;

        if (!this._visible || !this._visibleInternal || !this.preview.hasPages) {
            if (this.bar_widget)
                this._fadeOutButton(this.bar_widget);
            this._fadeOutButton(this.prev_widget);
            this._fadeOutButton(this.next_widget);
            return;
        }

        if (this.bar_widget)
            this._fadeInButton(this.bar_widget);

        if (currentPage > 0)
            this._fadeInButton(this.prev_widget);
        else
            this._fadeOutButton(this.prev_widget);

        if (numPages > currentPage + 1)
            this._fadeInButton(this.next_widget);
        else
            this._fadeOutButton(this.next_widget);
    },

    _fadeInButton: function(widget) {
        widget.show_all();
        Tweener.addTween(widget, { opacity: 1,
                                   time: 0.30,
                                   transition: 'easeOutQuad' });
    },

    _fadeOutButton: function(widget) {
        Tweener.addTween(widget, { opacity: 0,
                                   time: 0.30,
                                   transition: 'easeOutQuad',
                                   onComplete: function() {
                                       widget.hide();
                                   }});
    },

    show: function() {
        this._visible = true;
        this._visibleInternal = true;
        this._updateVisibility();
        this._queueAutoHide();
    },

    hide: function() {
        this._visible = false;
        this._visibleInternal = false;
        this._updateVisibility();
    },

    destroy: function() {
        if (this.bar_widget)
            this.bar_widget.destroy();
        this.prev_widget.destroy();
        this.next_widget.destroy();
        this._tapGesture = null;
    }
});

const PreviewSearchbar = new Lang.Class({
    Name: 'PreviewSearchbar',
    Extends: Searchbar.Searchbar,

    _init: function(preview) {
        this.preview = preview;

        this.parent();
    },

    createSearchWidget: function() {
        let box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL,
                                halign: Gtk.Align.CENTER});
        box.get_style_context().add_class('linked');

        this.searchEntry = new Gtk.SearchEntry({ width_request: 500 });
        this.searchEntry.connect('activate', Lang.bind(this, function() {
            Application.application.activate_action('find-next', null);
        }));
        box.add(this.searchEntry);

        this._prev = new Gtk.Button({ action_name: 'app.find-prev' });
        this._prev.set_image(new Gtk.Image({ icon_name: 'go-up-symbolic',
                                             icon_size: Gtk.IconSize.MENU }));
        this._prev.set_tooltip_text(_("Find Previous"));
        box.add(this._prev);

        this._next = new Gtk.Button({ action_name: 'app.find-next' });
        this._next.set_image(new Gtk.Image({ icon_name: 'go-down-symbolic',
                                             icon_size: Gtk.IconSize.MENU }));
        this._next.set_tooltip_text(_("Find Next"));
        box.add(this._next);

        return box;
    },

    entryChanged: function() {
        this.preview.search(this.searchEntry.get_text());
    },

    reveal: function() {
        this.parent();

        if (!this.searchEntry.get_text()) {
            this.searchEntry.set_text(this.preview.lastSearch);
            this.searchEntry.select_region(0, -1);
        }

        this.preview.search(this.searchEntry.get_text());
    },

    conceal: function() {
        this.searchChangeBlocked = true;
        this.parent();
        this.searchChangeBlocked = false;
    }
});
