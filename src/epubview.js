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
const Gtk = imports.gi.Gtk;
const WebKit2 = imports.gi.WebKit2;

const _ = imports.gettext.gettext;

const Documents = imports.documents;
const Preview = imports.preview;

const Lang = imports.lang;

function isEpub(mimeType) {
    return (mimeType == 'application/epub+zip');
}

const EPUBView = new Lang.Class({
    Name: 'EPUBView',
    Extends: Preview.Preview,

    _init: function(preview) {
        this.invertedColors = false;

        this.parent(preview);
    },

    createActions: function() {
        return [
            { name: 'find-prev',
              callback: Lang.bind(this, this.findPrev),
              accels: ['<Shift><Primary>g'] },
            { name: 'find-next',
              callback: Lang.bind(this, this.findNext),
              accels: ['<Primary>g'] },
            { name: 'font-increase',
              callback: Lang.bind(this, function() {
                this.increaseFontSize();
              }) },
            { name: 'font-decrease',
              callback: Lang.bind(this, function() {
                this.decreaseFontSize();
              }) },
            { name: 'font-normal',
              callback: Lang.bind(this, function() {
                this.defaultFontSize();
              }) },
            { name: 'font-invert-colors',
              callback: Lang.bind(this, function() {
                this.invertColors();
              }) }
        ];
    },

    createToolbar: function() {
        return new EPUBViewToolbar(this);
    },

    createView: function() {
        let view = new Gepub.Widget();
        let settings = view.get_settings();
        settings.set_zoom_text_only(true);

        view.connect('load-changed', Lang.bind(this, function(wview, ev, data) {
            if (ev == WebKit2.LoadEvent.FINISHED) {
               this.setInvertedColors();
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

        this.getAction('font-increase').enabled = true;
        this.getAction('font-decrease').enabled = true;
        this.getAction('font-normal').enabled = true;
        this.getAction('font-invert-colors').enabled = true;
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

    increaseFontSize: function() {
        var zoom = this.view.get_zoom_level();
        this.view.set_zoom_level(zoom + 0.2);
    },

    decreaseFontSize: function() {
        var zoom = this.view.get_zoom_level();
        this.view.set_zoom_level(zoom - 0.2);
    },

    defaultFontSize: function() {
        this.view.set_zoom_level(1);
    },

    setInvertedColors: function() {
        let script;
        if (this.invertedColors) {
            script = "document.querySelector('body').style.backgroundColor = 'black';";
            script += "document.querySelector('body').style.color = 'white';";
        } else {
            script = "document.querySelector('body').style.backgroundColor = '';";
            script += "document.querySelector('body').style.color = '';";
        }
        this.view.run_javascript(script, null, null);
    },

    invertColors: function(change) {
        this.invertedColors = !this.invertedColors;
        this.setInvertedColors();
    },
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

        let fontButton = new Gtk.MenuButton({ image: new Gtk.Image ({ icon_name: 'font-select-symbolic' }),
                                              menu_model: this._getFontMenu(),
                                              action_name: 'view.font-menu' });
        fontButton.set_sensitive(true);
        this.toolbar.pack_end(fontButton);
        this.toolbar.show_all();
    },

    _getFontMenu: function() {
        let new_action;
        let menuItem;
        let menu = new Gio.Menu();
        let application = Gio.Application.get_default();

        menu.append(_('increase font size'), 'view.font-increase');
        menu.append(_('decrease font size'), 'view.font-decrease');
        menu.append(_('default font size'), 'view.font-normal');

        menu.append(_('invert colors'), 'view.font-invert-colors');

        return menu;
    },

    createSearchbar: function() {
        return new EPUBSearchbar(this.preview);
    }
});
