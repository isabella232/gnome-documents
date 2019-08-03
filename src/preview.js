const Gio = imports.gi.Gio;
const Gdk = imports.gi.Gdk;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;

const Mainloop = imports.mainloop;

const Application = imports.application;
const ErrorBox = imports.errorBox;
const FullscreenAction = imports.fullscreenAction;
const MainToolbar = imports.mainToolbar;
const Password = imports.password;
const Properties = imports.properties;
const Searchbar = imports.searchbar;
const Utils = imports.utils;

const _ICON_SIZE = 32;
const _PDF_LOADER_TIMEOUT = 400;

var Preview = GObject.registerClass(class Preview extends Gtk.Stack {
    _init(overlay, mainWindow) {
        this._lastSearch = '';
        this._loadShowId = 0;
        this._controlsFlipId = 0;
        this._controlsVisible = false;
        this._fsStateId = 0;
        this._fsToolbar = null;
        this.overlay = overlay;
        this.mainWindow = mainWindow;

        super._init({ homogeneous: true,
                      transition_type: Gtk.StackTransitionType.CROSSFADE });

        this.actionGroup = this._createActionGroup();

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

        this.toolbar = this.createToolbar();

        this.contextMenu = this.createContextMenu();
        if (this.contextMenu)
            this.contextMenu.attach_to_widget(this.view, null);

        this.navControls = this.createNavControls();
        this.navControls.show();
        this.show_all();

        this._loadStartedId = Application.documentManager.connect('load-started', this.onLoadStarted.bind(this));
        this._loadFinishedId = Application.documentManager.connect('load-finished', this.onLoadFinished.bind(this));
        this._loadErrorId = Application.documentManager.connect('load-error', this.onLoadError.bind(this));
        this._passwordNeededId = Application.documentManager.connect('password-needed', this.onPasswordNeeded.bind(this));

        this._nightModeId = Application.application.connect('action-state-changed::night-mode', this._updateNightMode.bind(this));

        this.connect('destroy', () => {
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

            if (this._fsToolbar) {
                this._fsToolbar.destroy();
                this._fsToolbar = null;
            }

            if (this._fullscreenAction) {
                this._fullscreenAction.change_state(new GLib.Variant('b', false));
                this._fullscreenAction.disconnect(this._fsStateId);
            }

            if (this._nightModeId > 0) {
                Application.application.disconnect(this._nightModeId);
                this._nightModeId = 0;
            }
        });
    }

    _getDefaultActions() {
        let backAccels = ['Back'];
        if (this.get_direction() == Gtk.TextDirection.LTR)
            backAccels.push('<Alt>Left');
        else
            backAccels.push('<Alt>Right');

        return [
            { name: 'gear-menu',
              callback: Utils.actionToggleCallback,
              state: GLib.Variant.new('b', false),
              accels: ['F10'] },
            { name: 'properties',
              callback: this._properties.bind(this) },
            { name: 'open-current',
              callback: this._openCurrent.bind(this) },
            { name: 'prev-page',
              callback: this.goPrev.bind(this),
              accels: ['<Primary>Page_Up', 'Left'] },
            { name: 'next-page',
              callback: this.goNext.bind(this),
              accels: ['<Primary>Page_Down', 'Right'] },
            { name: 'go-back',
              callback: this.goBack.bind(this),
              accels: backAccels }
        ];
    }

    _properties() {
        let doc = Application.documentManager.getActiveItem();
        if (!doc)
            return;

        let dialog = new Properties.PropertiesDialog(doc.id);
        dialog.connect('response', (widget, response) => {
            widget.destroy();
        });
    }

    _openCurrent() {
        let doc = Application.documentManager.getActiveItem();
        if (doc)
            doc.open(this.mainWindow, Gtk.get_current_event_time());
    }

    _updateNightMode() {
        this.nightMode = Application.settings.get_boolean('night-mode');
    }

    _onFullscreenChanged(action) {
        let fullscreen = action.state.get_boolean();

        this.toolbar.visible = !fullscreen;
        this.getAction('gear-menu').change_state(GLib.Variant.new('b', false));

        if (fullscreen) {
            // create fullscreen toolbar (hidden by default)
            this._fsToolbar = this.createFullscreenToolbar();
            this.overlay.add_overlay(this._fsToolbar);

            this._fsToolbar.connect('show-controls', () => {
                this.controlsVisible = true;
            });

            Application.application.set_accels_for_action('view.fullscreen',
                                                          ['F11', 'Escape']);
        } else {
            this._fsToolbar.destroy();
            this._fsToolbar = null;

            Application.application.set_accels_for_action('view.fullscreen', ['F11']);
        }

        this._syncControlsVisible();
    }

    getFullscreenToolbar() {
        return this._fsToolbar;
    }

    get controlsVisible() {
        return this._controlsVisible;
    }

    set controlsVisible(visible) {
        // reset any pending timeout, as we're about to change controls state
        this.cancelControlsFlip();

        if (this._controlsVisible == visible)
            return;

        this._controlsVisible = visible;
        this._syncControlsVisible();
    }

    _flipControlsTimeout() {
        this._controlsFlipId = 0;
        let visible = this.controlsVisible;
        this.controlsVisible = !visible;

        return false;
    }

     queueControlsFlip() {
         if (this._controlsFlipId)
             return;

         let settings = Gtk.Settings.get_default();
         let doubleClick = settings.gtk_double_click_time;

         this._controlsFlipId = Mainloop.timeout_add(doubleClick, this._flipControlsTimeout.bind(this));
     }

     cancelControlsFlip() {
         if (this._controlsFlipId != 0) {
             Mainloop.source_remove(this._controlsFlipId);
             this._controlsFlipId = 0;
         }
     }

    _syncControlsVisible() {
        if (this._controlsVisible) {
            if (this._fsToolbar)
                this._fsToolbar.reveal();
        } else {
            if (this._fsToolbar)
                this._fsToolbar.conceal();
        }
    }

    _createActionGroup() {
        let actions = this.createActions().concat(this._getDefaultActions());
        let actionGroup = new Gio.SimpleActionGroup();
        Utils.populateActionGroup(actionGroup, actions, 'view');

        if (this.canFullscreen) {
            this._fullscreenAction = new FullscreenAction.FullscreenAction({ window: this.mainWindow });
            this._fsStateId = this._fullscreenAction.connect('notify::state', this._onFullscreenChanged.bind(this));
            actionGroup.add_action(this._fullscreenAction);
            Application.application.set_accels_for_action('view.fullscreen', ['F11']);
        }

        return actionGroup;
    }

    createActions() {
        return [];
    }

    createNavControls() {
        return new PreviewNavControls(this, this.overlay);
    }

    activateResult() {
        this.findNext();
    }

    createFullscreenToolbar() {
        return new PreviewFullscreenToolbar(this);
    }

    createToolbar() {
        return new PreviewToolbar(this);
    }

    createView() {
        throw(new Error('Not implemented'));
    }

    createContextMenu() {
        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/Documents/ui/preview-context-menu.ui');
        let model = builder.get_object('preview-context-menu');
        return Gtk.Menu.new_from_model(model);
    }

    _clearLoadTimer() {
        if (this._loadShowId != 0) {
            Mainloop.source_remove(this._loadShowId);
            this._loadShowId = 0;
        }
    }

    onPasswordNeeded(manager, doc) {
        this._clearLoadTimer();
        this._spinner.stop();

        let dialog = new Password.PasswordDialog(doc);
        dialog.connect('response', (widget, response) => {
            dialog.destroy();
            if (response == Gtk.ResponseType.CANCEL || response == Gtk.ResponseType.DELETE_EVENT)
                Application.documentManager.setActiveItem(null);
        });
    }

    onLoadStarted(manager, doc) {
        this._clearLoadTimer();
        this._loadShowId = Mainloop.timeout_add(_PDF_LOADER_TIMEOUT, () => {
            this._loadShowId = 0;

            this.set_visible_child_name('spinner');
            this._spinner.start();
            return false;
        });
    }

    onLoadFinished(manager, doc) {
        this._clearLoadTimer();
        this._spinner.stop();

        this.set_visible_child_name('view');
        this.getAction('open-current').enabled = (doc.defaultAppName != null);
        this._updateNightMode();
    }

    onLoadError(manager, doc, message, exception) {
        this._clearLoadTimer();
        this._spinner.stop();

        this._errorBox.update(message, exception.message);
        this.set_visible_child_name('error');
    }

    getAction(name) {
        return this.actionGroup.lookup_action(name);
    }

    goBack() {
        Application.documentManager.setActiveItem(null);
        Application.modeController.goBack();
    }

    goPrev() {
        throw (new Error('Not implemented'));
    }

    goNext() {
        throw (new Error('Not implemented'));
    }

    get hasPages() {
        return false;
    }

    get page() {
        return 0;
    }

    get numPages() {
        return 0;
    }

    search(str) {
        this._lastSearch = str;
    }

    get lastSearch() {
        return this._lastSearch;
    }

    get fullscreen() {
        if (!this.canFullscreen)
            return false;

        return this.getAction('fullscreen').state.get_boolean();
    }

    get canFullscreen() {
        return false;
    }

    set nightMode(v) {
        // do nothing
    }

    findPrev() {
        throw (new Error('Not implemented'));
    }

    findNext() {
        throw (new Error('Not implemented'));
    }
});

var PreviewToolbar = GObject.registerClass(class PreviewToolbar extends MainToolbar.MainToolbar {
    _init(preview) {
        this._fsStateId = 0;
        this.preview = preview;

        super._init();
        this.toolbar.set_show_close_button(true);

        // back button, on the left of the toolbar
        this.addBackButton();

        // menu button, on the right of the toolbar
        let menuButton = new Gtk.MenuButton({ image: new Gtk.Image ({ icon_name: 'view-more-symbolic' }),
                                              menu_model: this._getPreviewMenu(),
                                              action_name: 'view.gear-menu' });
        this.toolbar.pack_end(menuButton);

        this.updateTitle();
        this.toolbar.show_all();

        this.connect('destroy', () => {
            if (this._fsStateId > 0)
                this.preview.getAction('fullscreen').disconnect(this._fsStateId);
        });
    }

    _getPreviewMenu() {
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
    }

    _addNightmodeButton() {
        let nightmodeButton = new Gtk.ToggleButton({ image: new Gtk.Image ({ icon_name: 'display-brightness-symbolic' }),
                                                     tooltip_text: _("Night Mode"),
                                                     action_name: 'app.night-mode',
                                                     visible: true });
        this.toolbar.pack_end(nightmodeButton);
        return nightmodeButton;
    }

    _addFullscreenButton() {
        this._fullscreenButton = new Gtk.Button({ image: new Gtk.Image ({ icon_name: 'view-fullscreen-symbolic' }),
                                                  tooltip_text: _("Fullscreen"),
                                                  action_name: 'view.fullscreen',
                                                  visible: true });
        this.toolbar.pack_end(this._fullscreenButton);

        let action = this.preview.getAction('fullscreen');
        this._fsStateId = action.connect('notify::state', this._fullscreenStateChanged.bind(this));
        this._fullscreenStateChanged();
    }

    _fullscreenStateChanged() {
        let action = this.preview.getAction('fullscreen');
        let fullscreen = action.state.get_boolean();

        if (fullscreen)
            this._fullscreenButton.image.icon_name = 'view-restore-symbolic';
        else
            this._fullscreenButton.image.icon_name = 'view-fullscreen-symbolic';
    }

    createSearchbar() {
        return new PreviewSearchbar(this.preview);
    }

    updateTitle() {
        let primary = null;
        let doc = Application.documentManager.getActiveItem();

        if (doc)
            primary = doc.name;

        this.toolbar.set_title(primary);
    }
});

const PreviewFullscreenToolbar = GObject.registerClass({
    Signals: {
        'show-controls': {}
    }
}, class PreviewFullscreenToolbar extends Gtk.Revealer {
    _init(preview) {
        super._init({ valign: Gtk.Align.START });

        this.toolbar = preview.createToolbar();

        this.add(this.toolbar);
        this.show();

        // make controls show when a toolbar action is activated in fullscreen
        let actionNames = ['gear-menu', 'find'];
        let signalIds = [];

        actionNames.forEach((actionName) => {
            let signalName = 'action-state-changed::' + actionName;
            let signalId = preview.actionGroup.connect(signalName, (actionGroup, actionName, value) => {
                let state = value.get_boolean();
                if (state)
                    this.emit('show-controls');
            });

            signalIds.push(signalId);
        });

        this.toolbar.connect('destroy', () => {
            signalIds.forEach(function(signalId) {
                preview.actionGroup.disconnect(signalId);
            });
        });
    }

    handleEvent(event) {
        this.toolbar.handleEvent(event);
    }

    reveal() {
        this.set_reveal_child(true);
    }

    conceal() {
        this.set_reveal_child(false);
        this.toolbar.preview.getAction('find').change_state(GLib.Variant.new('b', false));
    }
});

const _AUTO_HIDE_TIMEOUT = 2;
var PREVIEW_NAVBAR_MARGIN = 30;

var PreviewNavControls = class PreviewNavControls {
    constructor(preview, overlay) {
        this._barRevealer = null;
        this.preview = preview;
        this._overlay = overlay;

        this._visible = false;
        this._visibleInternal = false;
        this._autoHideId = 0;
        this._motionId = 0;

        this.barWidget = this.createBarWidget();
        if (this.barWidget) {
            this._barRevealer = new Gtk.Revealer({ transition_type: Gtk.RevealerTransitionType.CROSSFADE,
                                                   margin: PREVIEW_NAVBAR_MARGIN,
                                                   valign: Gtk.Align.END });
            this._overlay.add_overlay(this._barRevealer);

            this.barWidget.get_style_context().add_class('osd');
            this._barRevealer.add(this.barWidget);
            this.barWidget.connect('notify::hover', () => {
                if (this.barWidget.hover)
                    this._onEnterNotify();
                else
                    this._onLeaveNotify();
            });

            this._barRevealer.show_all();
        }

        this._prevRevealer = new Gtk.Revealer({ transition_type: Gtk.RevealerTransitionType.CROSSFADE,
                                                margin_start: PREVIEW_NAVBAR_MARGIN,
                                                margin_end: PREVIEW_NAVBAR_MARGIN,
                                                halign: Gtk.Align.START,
                                                valign: Gtk.Align.CENTER });
        this._overlay.add_overlay(this._prevRevealer);

        let prevButton = new Gtk.Button({ image: new Gtk.Image ({ icon_name: 'go-previous-symbolic',
                                                                  pixel_size: 16 }),
                                          action_name: 'view.prev-page' });
        prevButton.get_style_context().add_class('osd');
        this._prevRevealer.add(prevButton);
        prevButton.connect('enter-notify-event', this._onEnterNotify.bind(this));
        prevButton.connect('leave-notify-event', this._onLeaveNotify.bind(this));

        this._nextRevealer = new Gtk.Revealer({ transition_type: Gtk.RevealerTransitionType.CROSSFADE,
                                                margin_start: PREVIEW_NAVBAR_MARGIN,
                                                margin_end: PREVIEW_NAVBAR_MARGIN,
                                                halign: Gtk.Align.END,
                                                valign: Gtk.Align.CENTER });
        this._overlay.add_overlay(this._nextRevealer);

        let nextButton = new Gtk.Button({ image: new Gtk.Image ({ icon_name: 'go-next-symbolic',
                                                                  pixel_size: 16 }),
                                          action_name: 'view.next-page' });
        nextButton.get_style_context().add_class('osd');
        this._nextRevealer.add(nextButton);
        nextButton.connect('enter-notify-event', this._onEnterNotify.bind(this));
        nextButton.connect('leave-notify-event', this._onLeaveNotify.bind(this));

        this._prevRevealer.show_all();
        this._nextRevealer.show_all();

        this._overlayMotionId = this._overlay.connect('motion-notify-event', this._onMotion.bind(this));

        this._tapGesture = new Gtk.GestureMultiPress({ propagation_phase: Gtk.PropagationPhase.CAPTURE,
                                                       touch_only: true,
                                                       widget: this.preview.view });
        this._tapGesture.connect('released', this._onMultiPressReleased.bind(this));
        this._tapGesture.connect('stopped', this._onMultiPressStopped.bind(this));
    }

    createBarWidget() {
        return null;
    }

    _onEnterNotify() {
        this._unqueueAutoHide();
        return false;
    }

    _onLeaveNotify() {
        this._queueAutoHide();
        return false;
    }

    _removeMotionTimeout() {
        if (this._motionId == 0)
            return;

        Mainloop.source_remove(this._motionId);
        this._motionId = 0;
    }

    _motionTimeout() {
        this._motionId = 0;
        this._visibleInternal = true;
        this._updateVisibility();
        if (this.barWidget && !this.barWidget.hover)
            this._queueAutoHide();
        return false;
    }

    _onMotion(widget, event) {
        if (this._motionId != 0)
            return false;

        let device = event.get_source_device();
        if (device.input_source == Gdk.InputSource.TOUCHSCREEN)
            return false;

        this._motionId = Mainloop.idle_add(this._motionTimeout.bind(this));
        return false;
    }

    _onMultiPressReleased() {
        this._tapGesture.set_state(Gtk.EventSequenceState.CLAIMED);
        this._visibleInternal = !this._visibleInternal;
        this._unqueueAutoHide();
        this._updateVisibility();
    }

    _onMultiPressStopped() {
        this._tapGesture.set_state(Gtk.EventSequenceState.DENIED);
    }

    _autoHide() {
        this._autoHideId = 0;
        this._visibleInternal = false;
        this._updateVisibility();
        return false;
    }

    _unqueueAutoHide() {
        if (this._autoHideId == 0)
            return;

        Mainloop.source_remove(this._autoHideId);
        this._autoHideId = 0;
    }

    _queueAutoHide() {
        this._unqueueAutoHide();
        this._autoHideId = Mainloop.timeout_add_seconds(_AUTO_HIDE_TIMEOUT, this._autoHide.bind(this));
    }

    _updateVisibility() {
        let currentPage = this.preview.page;
        let numPages = this.preview.numPages;

        if (!this._visible || !this._visibleInternal || !this.preview.hasPages) {
            if (this._barRevealer)
                this._barRevealer.reveal_child = false;
            this._prevRevealer.reveal_child = false;
            this._nextRevealer.reveal_child = false;
            return;
        }

        if (this._barRevealer)
            this._barRevealer.reveal_child = true;

        this._prevRevealer.reveal_child = currentPage > 0;
        this._nextRevealer.reveal_child = numPages > currentPage + 1;
    }

    show() {
        this._visible = true;
        this._visibleInternal = true;
        this._updateVisibility();
        this._queueAutoHide();
    }

    hide() {
        this._visible = false;
        this._visibleInternal = false;
        this._updateVisibility();
    }

    destroy() {
        this._unqueueAutoHide();
        this._removeMotionTimeout();

        if (this._overlayMotionId != 0) {
            this._overlay.disconnect(this._overlayMotionId);
            this._overlayMotionId = 0;
        }

        if (this._barRevealer)
            this._barRevealer.destroy();
        this._prevRevealer.destroy();
        this._nextRevealer.destroy();
        this._tapGesture = null;
    }
}

var PreviewSearchbar = GObject.registerClass(class PreviewSearchbar extends Searchbar.Searchbar {
    _init(preview) {
        this.preview = preview;

        super._init();

        this.connect('notify::search-mode-enabled', () => {
            let action = this.preview.getAction('find');
            action.change_state(GLib.Variant.new('b', this.search_mode_enabled));
        });
    }

    createSearchWidget() {
        let box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL,
                                halign: Gtk.Align.CENTER});
        box.get_style_context().add_class('linked');

        this.searchEntry = new Gtk.SearchEntry({ width_request: 500 });
        this.searchEntry.connect('activate', () => {
            this.preview.activateResult();
        });
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
    }

    entryChanged() {
        this.preview.search(this.searchEntry.get_text());
    }

    reveal() {
        super.reveal();

        if (!this.searchEntry.get_text()) {
            this.searchEntry.set_text(this.preview.lastSearch);
            this.searchEntry.select_region(0, -1);
        }

        this.preview.search(this.searchEntry.get_text());
    }

    conceal() {
        this.searchChangeBlocked = true;
        super.conceal();
        this.searchChangeBlocked = false;
    }
});
