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

const GdPrivate = imports.gi.GdPrivate;
const Gepub = imports.gi.Gepub;
const Gio = imports.gi.Gio;
const Gdk = imports.gi.Gdk;
const WebKit2 = imports.gi.WebKit2;

const _ = imports.gettext.gettext;

const Application = imports.application;
const Documents = imports.documents;
const Preview = imports.preview;

const Lang = imports.lang;

function isEpub(mimeType) {
    return (mimeType == 'application/epub+zip');
}

const _ZOOM_STEP = 0.2;

const EPUBView = new Lang.Class({
    Name: 'EPUBView',
    Extends: Preview.Preview,

    _init: function(overlay, mainWindow) {
        this.parent(overlay, mainWindow);

        let nightModeId = Application.application.connect('action-state-changed::night-mode',
            Lang.bind(this, this._updateNightMode));

        this.connect('destroy', Lang.bind(this,
            function() {
                Application.application.disconnect(nightModeId);
            }));
    },

    createActions: function() {
        return [
            { name: 'find-prev',
              callback: Lang.bind(this, this.findPrev),
              accels: ['<Shift><Primary>g'] },
            { name: 'find-next',
              callback: Lang.bind(this, this.findNext),
              accels: ['<Primary>g'] },
            { name: 'zoom-in',
              callback: Lang.bind(this, this._zoomIn),
              accels: ['<Primary>plus', '<Primary>equal'] },
            { name: 'zoom-out',
              callback: Lang.bind(this, this._zoomOut),
              accels: ['<Primary>minus'] }
        ];
    },

    createToolbar: function() {
        return new EPUBViewToolbar(this);
    },

    createView: function() {
        let view = new Gepub.Widget();
        let settings = view.get_settings();
        settings.zoom_text_only = true;

        view.connect('load-changed', Lang.bind(this, function(wview, ev, data) {
            if (ev == WebKit2.LoadEvent.FINISHED) {
               this._updateNightMode();
            }
        }));

        return view;
    },

    createContextMenu: function() {
        return null;
    },

    onLoadFinished: function(manager, doc) {
        this.parent(manager, doc);

        if (doc.viewType != Documents.ViewType.EPUB)
            return;

        let f = Gio.File.new_for_uri(doc.uri);
        this._epubdoc = new Gepub.Doc({ path: f.get_path() });
        this._epubdoc.init(null);

        this.view.doc = this._epubdoc;
        this._epubdoc.connect('notify::page', Lang.bind(this, this._onPageChanged));

        this._metadata = this._loadMetadata();

        this.set_visible_child_name('view');
    },

    _setInvertedColors: function(invert) {
        let script;
        let bgcolor;

        if (invert) {
            script = "document.querySelector('body').style.backgroundColor = 'black';";
            script += "document.querySelector('body').style.color = 'white';";
            bgcolor = new Gdk.RGBA({red: 0, green: 0, blue: 0, alpha: 1});
            this.view.set_background_color(bgcolor);
        } else {
            script = "document.querySelector('body').style.backgroundColor = '';";
            script += "document.querySelector('body').style.color = '';";
            bgcolor = new Gdk.RGBA({red: 255, green: 255, blue: 255, alpha: 1});
            this.view.set_background_color(bgcolor);
        }
        this.view.run_javascript(script, null, null);
    },

    _updateNightMode: function() {
        if (Application.application.isBooks) {
            let nightMode = Application.settings.get_boolean('night-mode');
            this._setInvertedColors(nightMode);
        }
    },

    _loadMetadata: function() {
        let file = Gio.File.new_for_path(this._epubdoc.path);
        if (!GdPrivate.is_metadata_supported_for_file(file))
            return null;

        let metadata = new GdPrivate.Metadata({ file: file });

        let [res, val] = metadata.get_int('page');
        if (res)
            this._epubdoc.page = val;

        return metadata;
    },

    _onPageChanged: function() {
        let pageNumber = this._epubdoc.page;
        if (this._metadata)
            this._metadata.set_int('page', pageNumber);
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

    get canFind() {
        return true;
    },

    findNext: function() {
        let fc = this.view.get_find_controller();
        fc.search_next();
    },

    findPrev: function() {
        let fc = this.view.get_find_controller();
        fc.search_previous();
    },

    _zoomIn: function() {
        var zoom = this.view.get_zoom_level();
        this.view.set_zoom_level(zoom + _ZOOM_STEP);
    },

    _zoomOut: function() {
        var zoom = this.view.get_zoom_level();
        this.view.set_zoom_level(zoom - _ZOOM_STEP);
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
        this.preview.getAction('find-prev').enabled = hasResults;
        this.preview.getAction('find-next').enabled = hasResults;
    },

    conceal: function() {
        let fc = this.preview.view.get_find_controller();
        fc.search_finish();

        this.parent();
    }
});

const EPUBViewToolbar = new Lang.Class({
    Name: 'EPUBViewToolbar',
    Extends: Preview.PreviewToolbar,

    _init: function(preview) {
        this.parent(preview);

        if (Application.application.isBooks) {
            let nightButton = this.addNightmodeButton();
            nightButton.show();
        }
    },

    createSearchbar: function() {
        return new EPUBSearchbar(this.preview);
    }
});
