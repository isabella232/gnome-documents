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
    Extends: Preview.Preview,

    _init: function(overlay) {
        this.parent(overlay);

        Application.documentManager.connect('load-started',
                                            Lang.bind(this, this._onLoadStarted));
        Application.documentManager.connect('load-error',
                                            Lang.bind(this, this._onLoadError));
        Application.modeController.connect('window-mode-changed',
                                           Lang.bind(this, this._onWindowModeChanged));
    },

    createView: function() {
        return new Gepub.Widget();
    },

    _onWindowModeChanged: function() {
        let windowMode = Application.modeController.getWindowMode();
        if (windowMode != WindowMode.WindowMode.PREVIEW_EPUB)
            this.navControls.hide();
    },

    _onLoadStarted: function(manager, doc) {
        if (doc.viewType != Documents.ViewType.EPUB)
            return;

        let f = Gio.File.new_for_uri(doc.uri);
        this._epubdoc = new Gepub.Doc({ path: f.get_path() });
        this._epubdoc.init(null);
        this.view.doc = this._epubdoc;

        this.set_visible_child_name('view');
    },

    _onLoadError: function(manager, doc, message, exception) {
        if (doc.viewType != Documents.ViewType.EPUB)
            return;

        this.setError(message, exception.message);
    },

    reset: function () {
        this.set_visible_child_full('view', Gtk.StackTransitionType.NONE);
        this.navControls.show();
    },

    goPrev: function() {
        this._epubdoc.go_prev();
    },

    goNext: function() {
        this._epubdoc.go_next();
    },

    get hasPages() {
        return true;
    },

    get page() {
        return this._epubdoc ? this._epubdoc.get_page() : 0;
    },

    get numPages() {
        return this._epubdoc ? this._epubdoc.get_n_pages() : 0;
    },

    search: function(str) {
        this.parent(str);

        let fc = this.view.get_find_controller();
        fc.search(str, WebKit2.FindOptions.CASE_INSENSITIVE, 0);
    },

    findNext: function() {
        let fc = this.view.get_find_controller();
        fc.search_next();
    },

    findPrev: function() {
        let fc = this.view.get_find_controller();
        fc.search_previous();
    }
});

const EPUBSearchbar = new Lang.Class({
    Name: 'EPUBSearchbar',
    Extends: Preview.PreviewSearchbar,

    _init: function(preview) {
        this.parent(preview);

        let fc = this.preview.view.get_find_controller();
        fc.connect('found-text', Lang.bind(this, function(view, matchCount, data) {
            this._onSearchChanged(this.preview, matchCount > 0);
        }));

        this._onSearchChanged(this.preview, false);
    },

    _onSearchChanged: function(view, hasResults) {
        let findPrev = Application.application.lookup_action('find-prev');
        let findNext = Application.application.lookup_action('find-next');
        findPrev.enabled = hasResults;
        findNext.enabled = hasResults;
    },

    conceal: function() {
        let fc = this.preview.view.get_find_controller();
        fc.search_finish();

        this.parent();
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
