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
const MainToolbar = imports.mainToolbar;
const Edit = imports.edit;
const Search = imports.search;
const Selections = imports.selections;
const View = imports.view;
const WindowMode = imports.windowMode;
const Documents = imports.documents;

const EvView = imports.gi.EvinceView;
const EvinceView = imports.evinceview;
const LOKView = imports.lokview;
const EPUBView = imports.epubview;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const _ = imports.gettext.gettext;

const Embed = new Lang.Class({
    Name: 'Embed',
    Extends: Gtk.Box,

    _init: function(mainWindow) {
        this._currentView = null;
        this._searchState = null;
        this._window = mainWindow;

        this.parent({ orientation: Gtk.Orientation.VERTICAL,
                      visible: true });

        this._titlebar = new Gtk.Grid({ visible: true });
        this._window.set_titlebar(this._titlebar);

        // create the toolbar for selected items, it's hidden by default
        this._selectionToolbar = new Selections.SelectionToolbar();
        this.pack_end(this._selectionToolbar, false, false, 0);

        this._stackOverlay = new Gtk.Overlay({ visible: true });
        this.pack_end(this._stackOverlay, true, true, 0);

        this._stack = new Gtk.Stack({ visible: true,
                                      homogeneous: true,
                                      transition_type: Gtk.StackTransitionType.CROSSFADE });
        this._stackOverlay.add(this._stack);

        // pack the OSD notification widget
        this._stackOverlay.add_overlay(Application.notificationManager);

        // now create the actual content widgets
        this._documents = new View.ViewContainer(WindowMode.WindowMode.DOCUMENTS);
        let label = Application.application.isBooks ? _('Books') : _("Documents");
        this._stack.add_titled(this._documents, 'documents', label);

        this._collections = new View.ViewContainer(WindowMode.WindowMode.COLLECTIONS);
        this._stack.add_titled(this._collections, 'collections', _("Collections"));

        this._search = new View.ViewContainer(WindowMode.WindowMode.SEARCH);
        this._stack.add_named(this._search, 'search');

        this._stack.connect('notify::visible-child',
                            Lang.bind(this, this._onVisibleChildChanged));

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

    _onActivateResult: function() {
        if (this._currentView)
            this._currentView.activateResult();
    },

    _restoreLastPage: function() {
        let windowMode = Application.modeController.getWindowMode();
        if (windowMode == WindowMode.WindowMode.NONE)
            return;

        let page;

        switch (windowMode) {
        case WindowMode.WindowMode.COLLECTIONS:
            page = 'collections';
            break;
        case WindowMode.WindowMode.DOCUMENTS:
            page = 'documents';
            break;
        case WindowMode.WindowMode.SEARCH:
            page = 'search';
            break;
        case WindowMode.WindowMode.PREVIEW_EV:
        case WindowMode.WindowMode.PREVIEW_LOK:
        case WindowMode.WindowMode.PREVIEW_EPUB:
            page = 'preview';
            break;
        default:
            throw(new Error('Not handled'));
            break;
        }

        this._stack.set_visible_child_name(page);
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

    _onVisibleChildChanged: function() {
        // Avoid switching by accident if we just happen to destroy
        // the previous view
        if (this._clearingView)
            return;

        let visibleChild = this._stack.visible_child;
        let windowMode = WindowMode.WindowMode.NONE;

        if (visibleChild == this._collections)
            windowMode = WindowMode.WindowMode.COLLECTIONS;
        else if (visibleChild == this._documents)
            windowMode = WindowMode.WindowMode.DOCUMENTS;

        if (windowMode == WindowMode.WindowMode.NONE)
            return;

        Application.modeController.setWindowMode(windowMode);
    },

    _onWindowModeChanged: function(object, newMode, oldMode) {
        switch (newMode) {
        case WindowMode.WindowMode.COLLECTIONS:
        case WindowMode.WindowMode.DOCUMENTS:
        case WindowMode.WindowMode.SEARCH:
            this._prepareForOverview(newMode, oldMode);
            break;
        case WindowMode.WindowMode.PREVIEW_EV:
            if (oldMode == WindowMode.WindowMode.EDIT)
                Application.documentManager.reloadActiveItem();
            this._prepareForPreview(EvinceView.EvinceView);
            break;
        case WindowMode.WindowMode.PREVIEW_LOK:
            if (oldMode == WindowMode.WindowMode.EDIT)
                Application.documentManager.reloadActiveItem();
            this._prepareForPreview(LOKView.LOKView);
            break;
        case WindowMode.WindowMode.PREVIEW_EPUB:
            this._prepareForPreview(EPUBView.EPUBView);
            break;
        case WindowMode.WindowMode.EDIT:
            this._prepareForPreview(Edit.EditView);
            break;
        case WindowMode.WindowMode.NONE:
            break;
         default:
            throw(new Error('Not handled'));
            break;
        }

        if (this._toolbar.searchbar)
            this._toolbar.searchbar.connectJS('activate-result',
                                              Lang.bind(this, this._onActivateResult));
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

    _clearViewState: function() {
        this._clearingView = true;
        if (this._preview) {
            this._preview.destroy();
            this._preview = null;
        }

        this._window.insert_action_group('view', null);
        this._clearingView = false;
    },

    _prepareForOverview: function(newMode, oldMode) {
        let createToolbar = (oldMode != WindowMode.WindowMode.COLLECTIONS &&
                             oldMode != WindowMode.WindowMode.DOCUMENTS &&
                             oldMode != WindowMode.WindowMode.SEARCH);

        let visibleChild;

        switch (newMode) {
        case WindowMode.WindowMode.COLLECTIONS:
            visibleChild = this._collections;
            break;
        case WindowMode.WindowMode.DOCUMENTS:
            visibleChild = this._documents;
            break;
        case WindowMode.WindowMode.SEARCH:
            visibleChild = this._search;
            break;
        default:
            throw(new Error('Not handled'));
            break;
        }

        this._clearViewState();

        if (createToolbar) {
            if (this._toolbar)
                this._toolbar.destroy();

            // pack the toolbar
            this._toolbar = new MainToolbar.OverviewToolbar(this._stack);
            this._titlebar.add(this._toolbar);
        }

        this._stack.set_visible_child(visibleChild);
        this._currentView = visibleChild;
    },

    _prepareForPreview: function(constructor) {
        this._clearViewState();
        if (this._toolbar)
            this._toolbar.destroy();

        this._preview = new constructor(this._stackOverlay, this._window);
        this._window.insert_action_group('view', this._preview.actionGroup);
        this._stack.add_named(this._preview, 'preview');

        // pack the toolbar
        this._toolbar = this._preview.createToolbar();
        this._titlebar.add(this._toolbar);

        this._stack.set_visible_child_name('preview');
        this._currentView = this._preview;
    },

    getMainToolbar: function() {
        let windowMode = Application.modeController.getWindowMode();
        let fullscreen = Application.modeController.getFullscreen();

        if (fullscreen && (windowMode == WindowMode.WindowMode.PREVIEW_EV))
            return this._preview.getFullscreenToolbar();
        else
            return this._toolbar;
    },

    getPreview: function() {
        return this._preview;
    }
});
