const GdPrivate = imports.gi.GdPrivate;
const Gio = imports.gi.Gio;
const Gdk = imports.gi.Gdk;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Tweener = imports.tweener.tweener;

const Application = imports.application;
const ErrorBox = imports.errorBox;
const MainToolbar = imports.mainToolbar;
const Password = imports.password;
const Properties = imports.properties;
const Searchbar = imports.searchbar;
const Utils = imports.utils;

const _ICON_SIZE = 32;
const _PDF_LOADER_TIMEOUT = 400;

const Preview = new Lang.Class({
    Name: 'Preview',
    Extends: Gtk.Stack,

    _init: function(overlay, mainWindow) {
        this._lastSearch = '';
        this._loadShowId = 0;
        this.overlay = overlay;
        this.mainWindow = mainWindow;

        this.parent({ homogeneous: true,
                      transition_type: Gtk.StackTransitionType.CROSSFADE });

        let actions = this.createActions().concat(this._getDefaultActions());
        this.actionGroup = new Gio.SimpleActionGroup();
        Utils.populateActionGroup(this.actionGroup, actions, 'view');

        this._errorBox = new ErrorBox.ErrorBox();
        this.add_named(this._errorBox, 'error');

        this._spinner = new Gtk.Spinner({ width_request: _ICON_SIZE,
                                          height_request: _ICON_SIZE,
                                          halign: Gtk.Align.CENTER,
                                          valign: Gtk.Align.CENTER });
        this.add_named(this._spinner, 'spinner');

        this.view = this.createView();
        this.add_named(this.view, 'view');
        this.view.show();
        this.set_visible_child_full('view', Gtk.StackTransitionType.NONE);

        this.contextMenu = this.createContextMenu();
        if (this.contextMenu)
            this.contextMenu.attach_to_widget(this.view, null);

        this.navControls = this.createNavControls();
        this.navControls.show();
        this.show_all();

        this._loadStartedId = Application.documentManager.connect('load-started',
                                                                  Lang.bind(this, this.onLoadStarted));
        this._loadFinishedId = Application.documentManager.connect('load-finished',
                                                                   Lang.bind(this, this.onLoadFinished));
        this._loadErrorId = Application.documentManager.connect('load-error',
                                                                Lang.bind(this, this.onLoadError));
        this._passwordNeededId = Application.documentManager.connect('password-needed',
                                                                     Lang.bind(this, this.onPasswordNeeded));
    },

    _getDefaultActions: function() {
        return [
            { name: 'gear-menu',
              callback: Utils.actionToggleCallback,
              state: GLib.Variant.new('b', false),
              accels: ['F10'] },
            { name: 'properties',
              callback: Lang.bind(this, this._properties) },
            { name: 'open-current',
              callback: Lang.bind(this, this._openCurrent) }
        ];
    },

    _properties: function() {
        let doc = Application.documentManager.getActiveItem();
        if (!doc)
            return;

        let dialog = new Properties.PropertiesDialog(doc.id);
        dialog.connect('response', Lang.bind(this, function(widget, response) {
            widget.destroy();
        }));
    },

    _openCurrent: function() {
        let doc = Application.documentManager.getActiveItem();
        if (doc)
            doc.open(this.mainWindow.get_screen(), Gtk.get_current_event_time());
    },

    vfunc_destroy: function() {
        if (this._loadStartedId > 0) {
            Application.documentManager.disconnect(this._loadStartedId);
            this._loadStartedId = 0;
        }
        if (this._loadFinishedId > 0) {
            Application.documentManager.disconnect(this._loadFinishedId);
            this._loadFinishedId = 0;
        }
        if (this._loadErrorId > 0) {
            Application.documentManager.disconnect(this._loadErrorId);
            this._loadErrorId = 0;
        }
        if (this._passwordNeededId > 0) {
            Application.documentManager.disconnect(this._passwordNeededId);
            this._passwordNeededId = 0;
        }
        if (this.navControls) {
            this.navControls.destroy();
            this.navControls = null;
        }

        this.parent();
    },

    createActions: function() {
        return [];
    },

    createNavControls: function() {
        return new PreviewNavControls(this, this.overlay);
    },

    createToolbar: function() {
        let toolbar = new PreviewToolbar(this);
        toolbar.searchbar.connectJS('activate-result',
                                    Lang.bind(this, this.findNext));
        return toolbar;
    },

    createView: function() {
        throw(new Error('Not implemented'));
    },

    createContextMenu: function() {
        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/Documents/ui/preview-context-menu.ui');
        let model = builder.get_object('preview-context-menu');
        return Gtk.Menu.new_from_model(model);
    },

    _clearLoadTimer: function() {
        if (this._loadShowId != 0) {
            Mainloop.source_remove(this._loadShowId);
            this._loadShowId = 0;
        }
    },

    onPasswordNeeded: function(manager, doc) {
        this._clearLoadTimer();
        this._spinner.stop();

        let dialog = new Password.PasswordDialog(doc);
        dialog.connect('response', Lang.bind(this, function(widget, response) {
            dialog.destroy();
            if (response == Gtk.ResponseType.CANCEL || response == Gtk.ResponseType.DELETE_EVENT)
                Application.documentManager.setActiveItem(null);
        }));
    },

    onLoadStarted: function(manager, doc) {
        this._clearLoadTimer();
        this._loadShowId = Mainloop.timeout_add(_PDF_LOADER_TIMEOUT, Lang.bind(this, function() {
            this._loadShowId = 0;

            this.set_visible_child_name('spinner');
            this._spinner.start();
            return false;
        }));
    },

    onLoadFinished: function(manager, doc) {
        this._clearLoadTimer();
        this._spinner.stop();

        this.set_visible_child_name('view');
        this.getAction('open-current').enabled = (doc.defaultApp != null);
    },

    onLoadError: function(manager, doc, message, exception) {
        this._clearLoadTimer();
        this._spinner.stop();

        this._errorBox.update(message, exception.message);
        this.set_visible_child_name('error');
    },

    getAction: function(name) {
        return this.actionGroup.lookup_action(name);
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

    get canFind() {
        return false;
    },

    findPrev: function() {
        throw (new Error('Not implemented'));
    },

    findNext: function() {
        throw (new Error('Not implemented'));
    },

    scroll: function(direction) {
        throw (new Error('Not implemented'));
    }
});

const PreviewToolbar = new Lang.Class({
    Name: 'PreviewToolbar',
    Extends: MainToolbar.MainToolbar,

    _init: function(preview) {
        this.preview = preview;

        this.parent();
        this.toolbar.set_show_close_button(true);

        // back button, on the left of the toolbar
        let backButton = this.addBackButton();
        backButton.connect('clicked', Lang.bind(this,
            function() {
                Application.documentManager.setActiveItem(null);
                Application.modeController.goBack();
            }));

        // menu button, on the right of the toolbar
        let menuButton = new Gtk.MenuButton({ image: new Gtk.Image ({ icon_name: 'open-menu-symbolic' }),
                                              menu_model: this._getPreviewMenu(),
                                              action_name: 'view.gear-menu' });
        this.toolbar.pack_end(menuButton);

        // search button, on the right of the toolbar
        if (this.preview.canFind)
            this.addSearchButton();

        this.updateTitle();
        this.toolbar.show_all();
    },

    _getPreviewMenu: function() {
        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/Documents/ui/preview-menu.ui');
        let menu = builder.get_object('preview-menu');

        let doc = Application.documentManager.getActiveItem();
        if (doc && doc.defaultAppName) {
            let section = builder.get_object('open-section');
            section.remove(0);
            section.prepend(_("Open with %s").format(doc.defaultAppName), 'view.open-current');
        }

        return menu;
    },

    createSearchbar: function() {
        return new PreviewSearchbar(this.preview);
    },

    updateTitle: function() {
        let primary = null;
        let doc = Application.documentManager.getActiveItem();

        if (doc)
            primary = doc.name;

        this.toolbar.set_title(primary);
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

        this.barWidget = this.createBarWidget();
        if (this.barWidget) {
            this.barWidget.get_style_context().add_class('osd');
            this._overlay.add_overlay(this.barWidget);
            this.barWidget.connect('notify::hover', Lang.bind(this, function() {
                if (this.barWidget.hover)
                    this._onEnterNotify();
                else
                    this._onLeaveNotify();
            }));
        }

        this._prevWidget = new Gtk.Button({ image: new Gtk.Image ({ icon_name: 'go-previous-symbolic',
                                                                    pixel_size: 16 }),
                                            margin_start: PREVIEW_NAVBAR_MARGIN,
                                            margin_end: PREVIEW_NAVBAR_MARGIN,
                                            halign: Gtk.Align.START,
                                            valign: Gtk.Align.CENTER });
        this._prevWidget.get_style_context().add_class('osd');
        this._overlay.add_overlay(this._prevWidget);
        this._prevWidget.connect('clicked', Lang.bind(this, this._onPrevClicked));
        this._prevWidget.connect('enter-notify-event', Lang.bind(this, this._onEnterNotify));
        this._prevWidget.connect('leave-notify-event', Lang.bind(this, this._onLeaveNotify));

        this._nextWidget = new Gtk.Button({ image: new Gtk.Image ({ icon_name: 'go-next-symbolic',
                                                                    pixel_size: 16 }),
                                            margin_start: PREVIEW_NAVBAR_MARGIN,
                                            margin_end: PREVIEW_NAVBAR_MARGIN,
                                            halign: Gtk.Align.END,
                                            valign: Gtk.Align.CENTER });
        this._nextWidget.get_style_context().add_class('osd');
        this._overlay.add_overlay(this._nextWidget);
        this._nextWidget.connect('clicked', Lang.bind(this, this._onNextClicked));
        this._nextWidget.connect('enter-notify-event', Lang.bind(this, this._onEnterNotify));
        this._nextWidget.connect('leave-notify-event', Lang.bind(this, this._onLeaveNotify));

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
        if (this.barWidget && !this.barWidget.hover)
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
            if (this.barWidget)
                this._fadeOutButton(this.barWidget);
            this._fadeOutButton(this._prevWidget);
            this._fadeOutButton(this._nextWidget);
            return;
        }

        if (this.barWidget)
            this._fadeInButton(this.barWidget);

        if (currentPage > 0)
            this._fadeInButton(this._prevWidget);
        else
            this._fadeOutButton(this._prevWidget);

        if (numPages > currentPage + 1)
            this._fadeInButton(this._nextWidget);
        else
            this._fadeOutButton(this._nextWidget);
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
        if (this.barWidget)
            this.barWidget.destroy();
        this._prevWidget.destroy();
        this._nextWidget.destroy();
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
            this.preview.activateResult();
        }));
        box.add(this.searchEntry);

        this._prev = new Gtk.Button({ action_name: 'view.find-prev' });
        this._prev.set_image(new Gtk.Image({ icon_name: 'go-up-symbolic',
                                             icon_size: Gtk.IconSize.MENU }));
        this._prev.set_tooltip_text(_("Find Previous"));
        box.add(this._prev);

        this._next = new Gtk.Button({ action_name: 'view.find-next' });
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
