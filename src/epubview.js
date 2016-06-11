/*
 * Copyright (c) 2016 Daniel Garcia <danigm@wadobo.com>
 *
 * Gnome Documents is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 *
 * Gnome Documents is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
 * for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with Gnome Documents; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 * Author: Daniel Garcia <danigm@wadobo.com>
 *
 */

const GLib = imports.gi.GLib;
const Gdk = imports.gi.Gdk;
const Gepub = imports.gi.Gepub;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const WebKit2 = imports.gi.WebKit2;

const _ = imports.gettext.gettext;

const Lang = imports.lang;

const Application = imports.application;
const Documents = imports.documents;
const ErrorBox = imports.errorBox;
const MainToolbar = imports.mainToolbar;
const Searchbar = imports.searchbar;
const WindowMode = imports.windowMode;

const Mainloop = imports.mainloop;
const Signals = imports.signals;
const Tweener = imports.tweener.tweener;

function isEpub(mimeType) {
    return (mimeType == 'application/epub+zip');
}

const EPUBView = new Lang.Class({
    Name: 'EPUBView',
    Extends: Gtk.Stack,

    _init: function(overlay) {
        this.parent({ homogeneous: true,
                      transition_type: Gtk.StackTransitionType.CROSSFADE });

        this._uri = null;
        this._overlay = overlay;
        this.page = 1;

        this._errorBox = new ErrorBox.ErrorBox();
        this.add_named(this._errorBox, 'error');

        this._sw = new Gtk.ScrolledWindow({ hexpand: true,
                                            vexpand: true });

        this.add_named(this._sw, 'view');
        this._createView();

        this.show_all();

        Application.documentManager.connect('load-started',
                                            Lang.bind(this, this._onLoadStarted));
        Application.documentManager.connect('load-error',
                                            Lang.bind(this, this._onLoadError));
        Application.modeController.connect('window-mode-changed', Lang.bind(this,
            this._onWindowModeChanged));

        let findPrev = Application.application.lookup_action('find-prev');
        let findPrevId = findPrev.connect('activate', Lang.bind(this, this._findPrev));
        let findNext = Application.application.lookup_action('find-next');
        let findNextId = findNext.connect('activate',  Lang.bind(this, this._findNext));
    },

    _findNext: function() {
        let fc = this.view.get_find_controller();
        fc.search_next();
    },

    _findPrev: function() {
        let fc = this.view.get_find_controller();
        fc.search_previous();
    },

    _onWindowModeChanged: function() {
        let windowMode = Application.modeController.getWindowMode();
        if (windowMode != WindowMode.WindowMode.PREVIEW_EPUB) {
            this._navControls.hide();
        }
    },

    _onLoadStarted: function(manager, doc) {
        if (doc.viewType != Documents.ViewType.EPUB)
            return;

        let f = Gio.File.new_for_uri(doc.uri);
        this._doc = doc;
        this._epubdoc = new Gepub.Doc({ path: f.get_path() });
        this._epubdoc.init(null);
        this._epubSpine = this._epubdoc.get_spine();
        this._load_current();
        this.set_visible_child_name('view');
    },

    _onLoadError: function(manager, doc, message, exception) {
        if (doc.viewType != Documents.ViewType.EPUB)
            return;
        this._setError(message, exception.message);
    },

    _getResource: function(req) {
        var uri = req.get_uri();
        // removing "epub://"
        var path = uri.slice(7);
        var stream = new Gio.MemoryInputStream();
        var data = this._epubdoc.get_resource_v(path);
        var mime = this._epubdoc.get_resource_mime(path);
        stream.add_data(data);
        req.finish(stream, data.length, mime);
    },

    reset: function () {
        if (!this.view)
            return;

        this.set_visible_child_full('view', Gtk.StackTransitionType.NONE);
        this.page = 1;
        this._navControls.show();
    },

    _createView: function() {
        this.view = new WebKit2.WebView();
        var ctx = this.view.get_context();
        ctx.register_uri_scheme("epub", Lang.bind(this, this._getResource));

        this._sw.add(this.view);
        this.view.show();

        this._navControls = new EPUBViewNavControls(this, this._overlay);
        this.set_visible_child_full('view', Gtk.StackTransitionType.NONE);
    },

    _setError: function(primary, secondary) {
        this._errorBox.update(primary, secondary);
        this.set_visible_child_name('error');
    },

    goNext: function() {
        if (this._epubdoc.go_next()) {
            this.page++;
            this._load_current();
        }
    },

    goPrev: function() {
        if (this._epubdoc.go_prev()) {
            this.page--;
            this._load_current();
        }
    },

    _load_current: function() {
        var mime = this._epubdoc.get_current_mime();
        var current = this._epubdoc.get_current_with_epub_uris ();
        this.view.load_bytes(new GLib.Bytes(current), mime, "UTF-8", null);
    }
});

const EPUBSearchbar = new Lang.Class({
    Name: 'EPUBSearchbar',
    Extends: Searchbar.Searchbar,

    _init: function(previewView) {
        this._previewView = previewView;
        this.parent();
    },

    createSearchWidgets: function() {
        this._searchContainer = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL,
                                              halign: Gtk.Align.CENTER});
        this._searchContainer.get_style_context().add_class('linked');

        this._searchEntry = new Gtk.SearchEntry({ width_request: 500 });
        this._searchEntry.connect('activate', Lang.bind(this, function() {
            Application.application.activate_action('find-next', null);
        }));
        this._searchContainer.add(this._searchEntry);

        this._prev = new Gtk.Button({ action_name: 'app.find-prev' });
        this._prev.set_image(new Gtk.Image({ icon_name: 'go-up-symbolic',
                                             icon_size: Gtk.IconSize.MENU }));
        this._prev.set_tooltip_text(_("Find Previous"));
        this._searchContainer.add(this._prev);

        this._next = new Gtk.Button({ action_name: 'app.find-next' });
        this._next.set_image(new Gtk.Image({ icon_name: 'go-down-symbolic',
                                             icon_size: Gtk.IconSize.MENU }));
        this._next.set_tooltip_text(_("Find Next"));
        this._searchContainer.add(this._next);

        let fc = this._previewView.view.get_find_controller();
        fc.connect('found-text', Lang.bind(this, function(w, match_count, data) {
            this._onSearchChanged(this._previewView, match_count > 0);
        }));

        this._onSearchChanged(this._previewView, false);
    },

    _onSearchChanged: function(view, results) {
        let findPrev = Application.application.lookup_action('find-prev');
        let findNext = Application.application.lookup_action('find-next');
        findPrev.enabled = results;
        findNext.enabled = results;
    },

    _search: function(str) {
        let fc = this._previewView.view.get_find_controller();
        fc.search(str, WebKit2.FindOptions.CASE_INSENSITIVE, 0);
    },

    entryChanged: function() {
        this._search(this._searchEntry.get_text());
    },

    reveal: function() {
        this.parent();
        this._search(this._searchEntry.get_text());
    },

    conceal: function() {
        this._search("");
        let fc = this._previewView.view.get_find_controller();
        fc.search_finish();

        this.searchChangeBlocked = true;
        this.parent();
        this.searchChangeBlocked = false;
    }
});

const EPUBViewToolbar = new Lang.Class({
    Name: 'EPUBViewToolbar',
    Extends: MainToolbar.MainToolbar,

    _init: function(previewView) {
        this._previewView = previewView;

        this.parent();
        this.toolbar.set_show_close_button(true);

        this._handleEvent = false;
        this._model = null;

        this._searchAction = Application.application.lookup_action('search');
        this._searchAction.enabled = true;

        this._gearMenu = Application.application.lookup_action('gear-menu');
        this._gearMenu.enabled = true;

        // back button, on the left of the toolbar
        let backButton = this.addBackButton();
        backButton.connect('clicked', Lang.bind(this, function() {
            Application.documentManager.setActiveItem(null);
            Application.modeController.goBack();
        }));

        // search button, on the right of the toolbar
        this.addSearchButton();

        this._setToolbarTitle();
        this.toolbar.show_all();
    },

    createSearchbar: function() {
        return new EPUBSearchbar(this._previewView);
    },

    _setToolbarTitle: function() {
        let primary = null;
        let doc = Application.documentManager.getActiveItem();

        if (doc)
            primary = doc.name;

        this.toolbar.set_title(primary);
    },
});

const _PREVIEW_NAVBAR_MARGIN = 30;
const _AUTO_HIDE_TIMEOUT = 2;

const EPUBViewNavControls = new Lang.Class({
    Name: 'EPUBViewNavControls',

    _init: function(epubView, overlay) {
        this._epubView = epubView;
        this._overlay = overlay;

        this._visible = false;
        this._visibleInternal = false;
        this._pageChangedId = 0;
        this._autoHideId = 0;
        this._motionId = 0;

        this.prev_widget = new Gtk.Button({ image: new Gtk.Image ({ icon_name: 'go-previous-symbolic',
                                                                    pixel_size: 16 }),
                                            margin: _PREVIEW_NAVBAR_MARGIN,
                                            halign: Gtk.Align.START,
                                            valign: Gtk.Align.CENTER });
        this.prev_widget.get_style_context().add_class('osd');
        this._overlay.add_overlay(this.prev_widget);
        this.prev_widget.connect('clicked', Lang.bind(this, this._onPrevClicked));
        this.prev_widget.connect('enter-notify-event', Lang.bind(this, this._onEnterNotify));
        this.prev_widget.connect('leave-notify-event', Lang.bind(this, this._onLeaveNotify));

        this.next_widget = new Gtk.Button({ image: new Gtk.Image ({ icon_name: 'go-next-symbolic',
                                                                    pixel_size: 16 }),
                                            margin: _PREVIEW_NAVBAR_MARGIN,
                                            halign: Gtk.Align.END,
                                            valign: Gtk.Align.CENTER });
        this.next_widget.get_style_context().add_class('osd');
        this._overlay.add_overlay(this.next_widget);
        this.next_widget.connect('clicked', Lang.bind(this, this._onNextClicked));
        this.next_widget.connect('enter-notify-event', Lang.bind(this, this._onEnterNotify));
        this.next_widget.connect('leave-notify-event', Lang.bind(this, this._onLeaveNotify));
        this._overlay.connect('motion-notify-event', Lang.bind(this, this._onMotion));
        this._visible = true;

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
        this._queueAutoHide();
        return false;
    },

    _onMotion: function(widget, event) {
        if (this._motionId != 0) {
            return false;
        }

        let device = event.get_source_device();
        if (device.input_source == Gdk.InputSource.TOUCHSCREEN) {
            return false;
        }

        this._motionId = Mainloop.idle_add(Lang.bind(this, this._motionTimeout));
        return false;
    },

    _onPrevClicked: function() {
        this._epubView.goPrev();
    },

    _onNextClicked: function() {
        this._epubView.goNext();
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
        if (!this._epubView) {
            return;
        }

        if (!this._visible || !this._visibleInternal) {
            this._fadeOutButton(this.prev_widget);
            this._fadeOutButton(this.next_widget);
            return;
        }

        if (this._epubView.page == 1) {
            this._fadeOutButton(this.prev_widget);
        } else {
            this._fadeInButton(this.prev_widget);
        }

        var l = this._epubView._epubSpine.length;
        if (this._epubView.page >= l) {
            this._fadeOutButton(this.next_widget);
        } else {
            this._fadeInButton(this.next_widget);
        }
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
                                   },
                                   onCompleteScope: this });
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
        this.prev_widget.destroy();
        this.next_widget.destroy();
    }
});
