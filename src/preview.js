const GdPrivate = imports.gi.GdPrivate;
const Gdk = imports.gi.Gdk;
const Gtk = imports.gi.Gtk;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Tweener = imports.tweener.tweener;

const _AUTO_HIDE_TIMEOUT = 2;
const PREVIEW_NAVBAR_MARGIN = 30;

const PreviewNavControls = new Lang.Class({
    Name: 'PreviewNavControls',

    _init: function(preview, overlay) {
        this._preview = preview;
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
                                                       widget: this._preview.view });
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
        this._preview.goPrev();
    },

    _onNextClicked: function() {
        this._preview.goNext();
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
        let currentPage = this._preview.page;
        let numPages = this._preview.numPages;

        if (!this._visible || !this._visibleInternal || !this._preview.hasPages) {
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
