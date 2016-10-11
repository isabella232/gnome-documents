/*
 * Copyright (c) 2011, 2013, 2015 Red Hat, Inc.
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
 * Author: Cosimo Cecchi <cosimoc@redhat.com>
 *
 */

const Lang = imports.lang;
const Mainloop = imports.mainloop;

const Application = imports.application;
const Search = imports.search;
const Selections = imports.selections;
const View = imports.view;
const WindowMode = imports.windowMode;

const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const _ = imports.gettext.gettext;

const Embed = new Lang.Class({
    Name: 'Embed',
    Extends: Gtk.Box,

    _init: function(mainWindow) {
        this._searchState = null;

        this.parent({ orientation: Gtk.Orientation.VERTICAL,
                      visible: true });

        this._titlebar = new Gtk.Grid({ visible: true });
        mainWindow.set_titlebar(this._titlebar);

        // create the toolbar for selected items, it's hidden by default
        this._selectionToolbar = new Selections.SelectionToolbar();
        this.pack_end(this._selectionToolbar, false, false, 0);

        this._view = new View.View(mainWindow);
        this.pack_end(this._view, true, true, 0);

        Application.modeController.connect('window-mode-changed',
                                           Lang.bind(this, this._onWindowModeChanged));
        Application.modeController.connect('fullscreen-changed',
                                           Lang.bind(this, this._onFullscreenChanged));

        Application.documentManager.connect('active-changed',
                                            Lang.bind(this, this._onActiveItemChanged));

        Application.searchTypeManager.connect('active-changed',
                                              Lang.bind(this, this._onSearchChanged));
        Application.sourceManager.connect('active-changed',
                                          Lang.bind(this, this._onSearchChanged));

        Application.searchController.connect('search-string-changed',
                                             Lang.bind(this, this._onSearchChanged));

        let windowMode = Application.modeController.getWindowMode();
        if (windowMode != WindowMode.WindowMode.NONE)
            this._onWindowModeChanged(Application.modeController, windowMode, WindowMode.WindowMode.NONE);
    },

    _onFullscreenChanged: function(controller, fullscreen) {
        this._toolbar.visible = !fullscreen;
        this._toolbar.sensitive = !fullscreen;
    },

    _onSearchChanged: function() {
        // Whenever a search constraint is specified we want to switch to
        // the search mode, and when all constraints have been lifted we
        // want to go back to the previous mode which can be either
        // collections or documents.
        //
        // However there are some exceptions, which are taken care of
        // elsewhere:
        //  - when moving from search to preview or collection view
        //  - when in preview or coming out of it

        let doc = Application.documentManager.getActiveItem();
        let windowMode = Application.modeController.getWindowMode();
        if (windowMode == WindowMode.WindowMode.SEARCH && doc)
            return;
        if (windowMode == WindowMode.WindowMode.PREVIEW_EV)
            return;

        let searchType = Application.searchTypeManager.getActiveItem();
        let source = Application.sourceManager.getActiveItem();
        let str = Application.searchController.getString();

        if (searchType.id == Search.SearchTypeStock.ALL &&
            source.id == Search.SearchSourceStock.ALL &&
            (!str || str == '')) {
            Application.modeController.goBack();
        } else {
            Application.modeController.setWindowMode(WindowMode.WindowMode.SEARCH);
        }
    },

    _onWindowModeChanged: function(object, newMode, oldMode) {
        let createToolbar = true;

        if (newMode == WindowMode.WindowMode.COLLECTIONS ||
            newMode == WindowMode.WindowMode.DOCUMENTS ||
            newMode == WindowMode.WindowMode.SEARCH) {
            createToolbar = (oldMode != WindowMode.WindowMode.COLLECTIONS &&
                             oldMode != WindowMode.WindowMode.DOCUMENTS &&
                             oldMode != WindowMode.WindowMode.SEARCH);
        }

        this._view.windowMode = newMode;

        if (createToolbar) {
            if (this._toolbar)
                this._toolbar.destroy();

            // pack the toolbar
            this._toolbar = this._view.createToolbar();
            if (this._toolbar.searchbar)
                this._toolbar.searchbar.connectJS('activate-result',
                                                  Lang.bind(this, this._onActivateResult));
            this._titlebar.add(this._toolbar);
        }
    },

    _onActivateResult: function() {
        this._view.activateResult();
    },

    _restoreSearch: function() {
        if (!this._searchState)
            return;

        Application.searchMatchManager.setActiveItem(this._searchState.searchMatch);
        Application.searchTypeManager.setActiveItem(this._searchState.searchType);
        Application.sourceManager.setActiveItem(this._searchState.source);
        Application.searchController.setString(this._searchState.str);
        this._searchState = null;
    },

    _saveSearch: function() {
        if (this._searchState)
            return;

        this._searchState = new Search.SearchState(Application.searchMatchManager.getActiveItem(),
                                                   Application.searchTypeManager.getActiveItem(),
                                                   Application.sourceManager.getActiveItem(),
                                                   Application.searchController.getString());
    },

    _onActiveItemChanged: function(manager, doc) {
        let windowMode = Application.modeController.getWindowMode();
        let showSearch = (windowMode == WindowMode.WindowMode.PREVIEW_EV && !doc
                          || windowMode == WindowMode.WindowMode.SEARCH && !doc);

        if (showSearch)
            this._restoreSearch();
        else
            this._saveSearch();

        Application.application.change_action_state('search', GLib.Variant.new('b', showSearch));
    },

    getMainToolbar: function() {
        let windowMode = Application.modeController.getWindowMode();
        let fullscreen = Application.modeController.getFullscreen();

        if (fullscreen && (windowMode == WindowMode.WindowMode.PREVIEW_EV))
            return this.getPreview().getFullscreenToolbar();
        else
            return this._toolbar;
    },

    getPreview: function() {
        return this._view.view;
    }
});
