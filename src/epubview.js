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
const GLib = imports.gi.GLib;
const WebKit2 = imports.gi.WebKit2;

const _ = imports.gettext.gettext;

const Documents = imports.documents;
const Preview = imports.preview;
const Utils = imports.utils;

const Lang = imports.lang;

function isEpub(mimeType) {
    return (mimeType == 'application/epub+zip');
}

const EPUBView = new Lang.Class({
    Name: 'EPUBView',
    Extends: Preview.Preview,

    createActions: function() {
        return [
            { name: 'find',
              callback: Utils.actionToggleCallback,
              state: GLib.Variant.new('b', false),
              stateChanged: Lang.bind(this, this._findStateChanged),
              accels: ['<Primary>f'] },
            { name: 'find-prev',
              callback: Lang.bind(this, this.findPrev),
              accels: ['<Shift><Primary>g'] },
            { name: 'find-next',
              callback: Lang.bind(this, this.findNext),
              accels: ['<Primary>g'] },
        ];
    },

    createToolbar: function() {
        return new EPUBViewToolbar(this);
    },

    createView: function() {
        let view = new Gepub.Widget();

        let fc = view.get_find_controller();
        fc.connect('found-text', Lang.bind(this, function(view, matchCount, data) {
            let hasResults = matchCount > 0;

            this.getAction('find-prev').enabled = hasResults;
            this.getAction('find-next').enabled = hasResults;
        }));

        return view;
    },

    createContextMenu: function() {
        return null;
    },

    onLoadFinished: function(manager, doc) {
        this.parent(manager, doc);

        let f = Gio.File.new_for_uri(doc.uri);
        this._epubdoc = new Gepub.Doc({ path: f.get_path() });
        this._epubdoc.init(null);

        this.view.doc = this._epubdoc;
        this._epubdoc.connect('notify::page', Lang.bind(this, this._onPageChanged));

        this._metadata = this._loadMetadata();

        this.set_visible_child_name('view');
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

    _findStateChanged: function(action) {
        if (action.state.get_boolean()) {
            this.toolbar.searchbar.reveal();
        } else {
            this.toolbar.searchbar.conceal();

            let fc = this.view.get_find_controller();
            fc.search_finish();
        }
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

const EPUBViewToolbar = new Lang.Class({
    Name: 'EPUBViewToolbar',
    Extends: Preview.PreviewToolbar,

    _init: function(preview) {
        this.parent(preview);

        this.addSearchButton('view.find');
    }
});
