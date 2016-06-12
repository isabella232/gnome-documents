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
const Gepub = imports.gi.Gepub;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const WebKit2 = imports.gi.WebKit2;

const _ = imports.gettext.gettext;

const Application = imports.application;
const Documents = imports.documents;
const ErrorBox = imports.errorBox;
const MainToolbar = imports.mainToolbar;
const Preview = imports.preview;
const Searchbar = imports.searchbar;
const WindowMode = imports.windowMode;

const Lang = imports.lang;
const Signals = imports.signals;

function isEpub(mimeType) {
    return (mimeType == 'application/epub+zip');
}

const EPUBView = new Lang.Class({
    Name: 'EPUBView',
    Extends: Gtk.Stack,

    _init: function(overlay) {
        this.parent({ homogeneous: true,
                      transition_type: Gtk.StackTransitionType.CROSSFADE });

        this._overlay = overlay;
        this._page = 1;

        this._errorBox = new ErrorBox.ErrorBox();
        this.add_named(this._errorBox, 'error');

        this._createView();
        this.show_all();

        Application.documentManager.connect('load-started',
                                            Lang.bind(this, this._onLoadStarted));
        Application.documentManager.connect('load-error',
                                            Lang.bind(this, this._onLoadError));
        Application.modeController.connect('window-mode-changed',
                                           Lang.bind(this, this._onWindowModeChanged));

        let findPrev = Application.application.lookup_action('find-prev');
        findPrev.connect('activate', Lang.bind(this, this._findPrev));
        let findNext = Application.application.lookup_action('find-next');
        findNext.connect('activate',  Lang.bind(this, this._findNext));
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
        if (windowMode != WindowMode.WindowMode.PREVIEW_EPUB)
            this._navControls.hide();
    },

    _onLoadStarted: function(manager, doc) {
        if (doc.viewType != Documents.ViewType.EPUB)
            return;

        let f = Gio.File.new_for_uri(doc.uri);
        this._doc = doc;
        this._epubdoc = new Gepub.Doc({ path: f.get_path() });
        this._epubdoc.init(null);
        this._epubSpine = this._epubdoc.get_spine();
        this._loadCurrent();
        this.set_visible_child_name('view');
    },

    _onLoadError: function(manager, doc, message, exception) {
        if (doc.viewType != Documents.ViewType.EPUB)
            return;

        this._setError(message, exception.message);
    },

    _getResource: function(req) {
        var uri = req.get_uri();
        // removing 'epub://'
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
        this._page = 1;
        this._navControls.show();
    },

    _createView: function() {
        this.view = new WebKit2.WebView();
        var ctx = this.view.get_context();
        ctx.register_uri_scheme('epub', Lang.bind(this, this._getResource));

        this.add_named(this.view, 'view');
        this.view.show();

        this._navControls = new Preview.PreviewNavControls(this, this._overlay);
        this.set_visible_child_full('view', Gtk.StackTransitionType.NONE);
    },

    _setError: function(primary, secondary) {
        this._errorBox.update(primary, secondary);
        this.set_visible_child_name('error');
    },

    _loadCurrent: function() {
        var mime = this._epubdoc.get_current_mime();
        var current = this._epubdoc.get_current_with_epub_uris ();
        this.view.load_bytes(new GLib.Bytes(current), mime, 'UTF-8', null);
    },

    goPrev: function() {
        if (this._epubdoc.go_prev()) {
            this._page--;
            this._loadCurrent();
        }
    },

    goNext: function() {
        if (this._epubdoc.go_next()) {
            this._page++;
            this._loadCurrent();
        }
    },

    get hasPages() {
        return true;
    },

    get page() {
        return this._page;
    },

    get numPages() {
        return this._epubSpine ? this._epubSpine.length : 0;
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
        this._search('');
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
