/*
 * Copyright (c) 2013, 2014, 2015 Red Hat, Inc.
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
 */

const WebKit = imports.gi.WebKit2;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const _ = imports.gettext.gettext;

const Lang = imports.lang;
const Mainloop = imports.mainloop;

const Application = imports.application;
const MainToolbar = imports.mainToolbar;
const Preview = imports.preview;

const _BLANK_URI = "about:blank";

const EditView = new Lang.Class({
    Name: 'EditView',
    Extends: Preview.Preview,

    _init: function(overlay, mainWindow) {
        this.parent(overlay, mainWindow);

        let doc = Application.documentManager.getActiveItem();
        if (doc.uri)
            this._webView.load_uri(doc.uri);
    },

    createActions: function() {
        return [
            { name: 'view-current',
              callback: Lang.bind(this, this._viewCurrent) }
        ];
    },

    createView: function() {
        let overlay = new Gtk.Overlay();

        this._webView = new WebKit.WebView();
        overlay.add(this._webView);
        this._webView.show();
        this._webView.connect('notify::estimated-load-progress', Lang.bind(this, this._onProgressChanged));

        this._progressBar = new Gtk.ProgressBar({ halign: Gtk.Align.FILL,
                                                  valign: Gtk.Align.START });
        this._progressBar.get_style_context().add_class('osd');
        overlay.add_overlay(this._progressBar);
        this._progressBar.show();

        let context = this._webView.get_context();
        let cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'gnome-documents', 'webkit']);
        context.set_disk_cache_directory(cacheDir);

        let cookie_manager = context.get_cookie_manager();
        let jarfile = GLib.build_filenamev([GLib.get_user_cache_dir(), 'gnome-documents', 'cookies.sqlite']);
        cookie_manager.set_persistent_storage(jarfile, WebKit.CookiePersistentStorage.SQLITE);
        overlay.show_all();
        return overlay;
    },

    createToolbar: function() {
        return new EditToolbar();
    },

    onLoadStarted: function() {
        this.getAction('view-current').enabled = false;
    },

    onLoadFinished: function(manager, doc) {
        if (doc.uri)
            this.getAction('view-current').enabled = true;
    },

    goBack: function() {
        Application.documentManager.setActiveItem(null);
        Application.modeController.goBack(2);
    },

    _viewCurrent: function() {
        Application.modeController.goBack();
    },

    _onProgressChanged: function() {
        if (!this._webView.uri || this._webView.uri == _BLANK_URI)
            return;

        let progress = this._webView.estimated_load_progress;
        let loading = this._webView.is_loading;

        if (progress == 1.0 || !loading) {
            if (!this._timeoutId)
                this._timeoutId = Mainloop.timeout_add(500, Lang.bind(this, this._onTimeoutExpired));
        } else {
            if (this._timeoutId) {
                Mainloop.source_remove(this._timeoutId);
                this._timeoutId = 0;
            }
            this._progressBar.show();
        }
        let value = 0.0
        if (loading || progress == 1.0)
            value = progress;
        this._progressBar.fraction = value;
    },

    _onTimeoutExpired: function() {
        this._timeoutId = 0;
        this._progressBar.hide();
        return false;
    }
});

const EditToolbar = new Lang.Class({
    Name: 'EditToolbar',
    Extends: MainToolbar.MainToolbar,

    _init: function() {
        this.parent();
        this.toolbar.set_show_close_button(true);

        // back button, on the left of the toolbar
        this.addBackButton();

        let viewButton = new Gtk.Button({ label: _("View"),
                                          action_name: 'view.view-current' });
        viewButton.get_style_context().add_class('suggested-action');
        this.toolbar.pack_end(viewButton);

        this._setToolbarTitle();
        this.show_all();
    },

    createSearchbar: function() {
        return null;
    },

    handleEvent: function(event) {
        return false;
    },

    _setToolbarTitle: function() {
        let primary = null;
        let doc = Application.documentManager.getActiveItem();

        if (doc)
            primary = doc.name;

        this.toolbar.set_title(primary);
    }
});
