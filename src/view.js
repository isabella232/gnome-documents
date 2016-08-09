/*
 * Copyright (c) 2011, 2015 Red Hat, Inc.
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

const Cairo = imports.gi.cairo;
const Edit = imports.edit;
const EvinceView = imports.evinceview;
const EPUBView = imports.epubview;
const Gd = imports.gi.Gd;
const Gdk = imports.gi.Gdk;
const Gettext = imports.gettext;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const LOKView = imports.lokview;
const _ = imports.gettext.gettext;

const Lang = imports.lang;
const Mainloop = imports.mainloop;

const Application = imports.application;
const ErrorBox = imports.errorBox;
const MainToolbar = imports.mainToolbar;
const Search = imports.search;
const WindowMode = imports.windowMode;
const Utils = imports.utils;

const _ICON_SIZE = 32;

function getController(windowMode) {
    let offsetController;
    let trackerController;

    switch (windowMode) {
    case WindowMode.WindowMode.COLLECTIONS:
        offsetController = Application.offsetCollectionsController;
        trackerController = Application.trackerCollectionsController;
        break;
    case WindowMode.WindowMode.DOCUMENTS:
        offsetController = Application.offsetDocumentsController;
        trackerController = Application.trackerDocumentsController;
        break;
    case WindowMode.WindowMode.SEARCH:
        offsetController = Application.offsetSearchController;
        trackerController = Application.trackerSearchController;
        break;
    default:
        throw(new Error('Not handled'));
        break;
    }

    return [ offsetController, trackerController ];
}

const _RESET_COUNT_TIMEOUT = 500; // msecs

const ViewModel = new Lang.Class({
    Name: 'ViewModel',
    Extends: Gtk.ListStore,

    _init: function(windowMode) {
        this.parent();
        this.set_column_types(
            [ GObject.TYPE_STRING,
              GObject.TYPE_STRING,
              GObject.TYPE_STRING,
              GObject.TYPE_STRING,
              Cairo.Surface,
              GObject.TYPE_LONG,
              GObject.TYPE_BOOLEAN,
              GObject.TYPE_UINT ]);

        this._infoUpdatedIds = {};
        this._resetCountId = 0;

        this._mode = windowMode;
        this._rowRefKey = "row-ref-" + this._mode;

        Application.documentManager.connect('item-added',
            Lang.bind(this, this._onItemAdded));
        Application.documentManager.connect('item-removed',
            Lang.bind(this, this._onItemRemoved));

        [ this._offsetController, this._trackerController ] = getController(this._mode);
        this._trackerController.connect('query-status-changed', Lang.bind(this,
            function(o, status) {
                if (!status)
                    return;
                this._clear();
            }));

        // populate with the initial items
        let items = Application.documentManager.getItems();
        for (let idx in items) {
            this._onItemAdded(Application.documentManager, items[idx]);
        }
    },

    _clear: function() {
        let items = Application.documentManager.getItems();
        for (let idx in items) {
            let doc = items[idx];
            doc.rowRefs[this._rowRefKey] = null;
        }

        this.clear();
    },

    _addItem: function(doc) {
        // Update the count so that OffsetController has the correct
        // values. Otherwise things like loading more items and "No
        // Results" page will not work correctly.
        this._resetCount();

        let iter = this.append();
        this.set(iter,
            [ 0, 1, 2, 3, 4, 5 ],
            [ doc.id, doc.uri, doc.name,
              doc.author, doc.surface, doc.mtime ]);

        let treePath = this.get_path(iter);
        let treeRowRef = Gtk.TreeRowReference.new(this, treePath);
        doc.rowRefs[this._rowRefKey] = treeRowRef;
    },

    _removeItem: function(doc) {
        // Update the count so that OffsetController has the correct
        // values. Otherwise things like loading more items and "No
        // Results" page will not work correctly.
        this._resetCount();

        this.foreach(Lang.bind(this,
            function(model, path, iter) {
                let id = model.get_value(iter, Gd.MainColumns.ID);

                if (id == doc.id) {
                    this.remove(iter);
                    return true;
                }

                return false;
            }));

        doc.rowRefs[this._rowRefKey] = null;
    },

    _onInfoUpdated: function(doc) {
        let activeCollection = Application.documentManager.getActiveCollection();
        let treeRowRef = doc.rowRefs[this._rowRefKey];

        if (this._mode == WindowMode.WindowMode.COLLECTIONS) {
            if (!doc.collection && treeRowRef && !activeCollection) {
                ;
            } else if (doc.collection && !treeRowRef && !activeCollection) {
                this._addItem(doc);
            }
        } else if (this._mode == WindowMode.WindowMode.DOCUMENTS) {
            if (doc.collection && treeRowRef) {
                ;
            } else if (!doc.collection && !treeRowRef) {
                this._addItem(doc);
            }
        }

        treeRowRef = doc.rowRefs[this._rowRefKey];
        if (treeRowRef) {
            let objectPath = treeRowRef.get_path();
            if (!objectPath)
                return;

            let objectIter = this.get_iter(objectPath)[1];
            if (objectIter)
                this.set(objectIter,
                    [ 0, 1, 2, 3, 4, 5 ],
                    [ doc.id, doc.uri, doc.name,
                      doc.author, doc.surface, doc.mtime ]);
        }
    },

    _onItemAdded: function(source, doc) {
        if (doc.rowRefs[this._rowRefKey])
            return;

        let infoUpdatedId = this._infoUpdatedIds[doc.id];
        if (infoUpdatedId) {
            doc.disconnect(infoUpdatedId);
            delete this._infoUpdatedIds[doc.id];
        }

        let activeCollection = Application.documentManager.getActiveCollection();
        let windowMode = Application.modeController.getWindowMode();

        if (!activeCollection || this._mode != windowMode) {
            if (this._mode == WindowMode.WindowMode.COLLECTIONS && !doc.collection
                || this._mode == WindowMode.WindowMode.DOCUMENTS && doc.collection) {
                this._infoUpdatedIds[doc.id] = doc.connect('info-updated', Lang.bind(this, this._onInfoUpdated));
                return;
            }
        }

        this._addItem(doc);
        this._infoUpdatedIds[doc.id] = doc.connect('info-updated', Lang.bind(this, this._onInfoUpdated));
    },

    _onItemRemoved: function(source, doc) {
        this._removeItem(doc);
        doc.disconnect(this._infoUpdatedIds[doc.id]);
        delete this._infoUpdatedIds[doc.id];
    },

    _resetCount: function() {
        if (this._resetCountId == 0) {
            this._resetCountId = Mainloop.timeout_add(_RESET_COUNT_TIMEOUT, Lang.bind(this,
                function() {
                    this._resetCountId = 0;
                    this._offsetController.resetItemCount();
                    return false;
                }));
        }
    }
});

const EmptyResultsBox = new Lang.Class({
    Name: 'EmptyResultsBox',
    Extends: Gtk.Grid,

    _init: function(mode) {
        this._mode = mode;
        this.parent({ orientation: Gtk.Orientation.VERTICAL,
                      row_spacing: 12,
                      hexpand: true,
                      vexpand: true,
                      halign: Gtk.Align.CENTER,
                      valign: Gtk.Align.CENTER });
        this.get_style_context().add_class('dim-label');

        this._addImage();
        this._addPrimaryLabel();
        this._addSecondaryLabel();

        this.show_all();
    },

    _addImage: function() {
        let iconName;
        if (this._mode == WindowMode.WindowMode.SEARCH)
            iconName = 'system-search-symbolic';
        else if (this._mode == WindowMode.WindowMode.COLLECTIONS)
            iconName = 'emblem-documents-symbolic';
        else
            iconName = 'x-office-document-symbolic';

        this.add(new Gtk.Image({ pixel_size: 128, icon_name: iconName, margin_bottom: 9 }));
    },

    _addPrimaryLabel: function() {
        let text;
        if (this._mode == WindowMode.WindowMode.COLLECTIONS)
            text = _("No collections found");
        else
            text = Application.application.isBooks ? _("No books found") : _("No documents found");

        this.add(new Gtk.Label({ label: '<b><span size="large">' + text + '</span></b>',
                                 use_markup: true,
                                 margin_top: 9 }));
    },

    _addSecondaryLabel: function() {
        if (this._mode == WindowMode.WindowMode.SEARCH) {
            this.add(new Gtk.Label({ label: _("Try a different search") }));
            return;
        }

        if (this._mode == WindowMode.WindowMode.COLLECTIONS) {
            let label;
            if (Application.application.isBooks)
                label = _("You can create collections from the Books view");
            else
                label = _("You can create collections from the Documents view");

            this.add(new Gtk.Label({ label: label }));
            return;
        }

        if (Application.application.isBooks)
            return;

        let documentsPath = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOCUMENTS);
        let detailsStr = _("Documents from your <a href=\"system-settings\">Online Accounts</a> and " +
                           "<a href=\"file://%s\">Documents folder</a> will appear here.").format(documentsPath);
        let details = new Gtk.Label({ label: detailsStr,
                                      use_markup: true });
        this.add(details);

        details.connect('activate-link', Lang.bind(this,
            function(label, uri) {
                if (uri != 'system-settings')
                    return false;

                try {
                    let app = Gio.AppInfo.create_from_commandline(
                        'gnome-control-center online-accounts', null, 0);

                    let screen = this.get_screen();
                    let display = screen ? screen.get_display() : Gdk.Display.get_default();
                    let ctx = display.get_app_launch_context();

                    if (screen)
                        ctx.set_screen(screen);

                    app.launch([], ctx);
                } catch(e) {
                    log('Unable to launch gnome-control-center: ' + e.message);
                }

                return true;
            }));
    }
});

const ViewContainer = new Lang.Class({
    Name: 'ViewContainer',
    Extends: Gtk.Stack,

    _init: function(windowMode) {
        this._edgeHitId = 0;
        this._mode = windowMode;

        this._model = new ViewModel(this._mode);

        this.parent({ homogeneous: true,
                      transition_type: Gtk.StackTransitionType.CROSSFADE });

        let actions = this._getDefaultActions();
        this.actionGroup = new Gio.SimpleActionGroup();
        Utils.populateActionGroup(this.actionGroup, actions, 'view');

        this.view = new Gd.MainView({ shadow_type: Gtk.ShadowType.NONE });
        this.add_named(this.view, 'view');

        this._noResults = new EmptyResultsBox(this._mode);
        this.add_named(this._noResults, 'no-results');

        this._errorBox = new ErrorBox.ErrorBox();
        this.add_named(this._errorBox, 'error');

        this._spinner = new Gtk.Spinner({ width_request: _ICON_SIZE,
                                          height_request: _ICON_SIZE,
                                          halign: Gtk.Align.CENTER,
                                          valign: Gtk.Align.CENTER });
        this.add_named(this._spinner, 'spinner');

        this.show_all();
        this.set_visible_child_full('view', Gtk.StackTransitionType.NONE);

        this.view.connect('item-activated',
                          Lang.bind(this, this._onItemActivated));
        this.view.connect('selection-mode-request',
                          Lang.bind(this, this._onSelectionModeRequest));
        this.view.connect('view-selection-changed',
                          Lang.bind(this, this._onViewSelectionChanged));

        this._updateTypeForSettings();
        this._updateSortForSettings();

        // setup selection controller => view
        Application.selectionController.connect('selection-mode-changed',
            Lang.bind(this, this._onSelectionModeChanged));
        this._onSelectionModeChanged();

        Application.modeController.connect('window-mode-changed',
            Lang.bind(this, this._onWindowModeChanged));
        this._onWindowModeChanged();

        [ this._offsetController, this._trackerController ] = getController(this._mode);

        this._offsetController.connect('item-count-changed', Lang.bind(this,
            function(controller, count) {
                if (count == 0)
                    this.set_visible_child_name('no-results');
                else
                    this.set_visible_child_name('view');
            }));

        this._trackerController.connect('query-error',
            Lang.bind(this, this._onQueryError));
        this._trackerController.connect('query-status-changed',
            Lang.bind(this, this._onQueryStatusChanged));
        // ensure the tracker controller is started
        this._trackerController.start();

        // this will create the model if we're done querying
        this._onQueryStatusChanged();
    },

    _getDefaultActions: function() {
        return [
            { name: 'select-all',
              callback: Lang.bind(this, this._selectAll),
              accels: ['<Primary>a'] },
            { name: 'select-none',
              callback: Lang.bind(this, this._selectNone) },
            { settingsKey: 'view-as',
              stateChanged: Lang.bind(this, this._updateTypeForSettings) },
            { settingsKey: 'sort-by',
              stateChanged: Lang.bind(this, this._updateSortForSettings) },
            { name: 'search-source',
              parameter_type: 's',
              state: GLib.Variant.new('s', Search.SearchSourceStock.ALL),
              stateChanged: Lang.bind(this, this._updateSearchSource),
              create_hook: Lang.bind(this, this._initSearchSource) },
            { name: 'search-type',
              parameter_type: 's',
              state: GLib.Variant.new('s', Search.SearchTypeStock.ALL),
              stateChanged: Lang.bind(this, this._updateSearchType),
              create_hook: Lang.bind(this, this._initSearchType) },
            { name: 'search-match',
              parameter_type: 's',
              state: GLib.Variant.new('s', Search.SearchMatchStock.ALL),
              stateChanged: Lang.bind(this, this._updateSearchMatch),
              create_hook: Lang.bind(this, this._initSearchMatch) }
        ];
    },

    _selectAll: function() {
        Application.selectionController.setSelectionMode(true);
        this.view.select_all();
    },

    _selectNone: function() {
        this.view.unselect_all();
    },

    _updateTypeForSettings: function() {
        let viewType = Application.settings.get_enum('view-as');
        this.view.set_view_type(viewType);

        if (viewType == Gd.MainViewType.LIST)
            this._addListRenderers();
    },

    _updateSortForSettings: function() {
        let sortBy = Application.settings.get_enum('sort-by');
        let sortType;

        switch (sortBy) {
        case Gd.MainColumns.PRIMARY_TEXT:
            sortType = Gtk.SortType.ASCENDING;
            break;
        case Gd.MainColumns.SECONDARY_TEXT:
            sortType = Gtk.SortType.ASCENDING;
            break;
        case Gd.MainColumns.MTIME:
            sortType = Gtk.SortType.DESCENDING;
            break;
        default:
            sortBy = Gd.MainColumns.MTIME;
            sortType = Gtk.SortType.DESCENDING;
            break;
        }

        this._model.set_sort_column_id(sortBy, sortType);
    },

    _initSearchSource: function(action) {
        Application.sourceManager.connect('active-changed', Lang.bind(this, function(manager, activeItem) {
            action.state = GLib.Variant.new('s', activeItem.id);
        }));
    },

    _initSearchType: function(action) {
        Application.searchTypeManager.connect('active-changed', Lang.bind(this, function(manager, activeItem) {
            action.state = GLib.Variant.new('s', activeItem.id);
        }));
    },

    _initSearchMatch: function(action) {
        Application.searchMatchManager.connect('active-changed', Lang.bind(this, function(manager, activeItem) {
            action.state = GLib.Variant.new('s', activeItem.id);
        }));
    },

    _updateSearchSource: function(action) {
        let itemId = action.state.get_string()[0];
        Application.sourceManager.setActiveItemById(itemId);
    },

    _updateSearchType: function(action) {
        let itemId = action.state.get_string()[0];
        Application.searchTypeManager.setActiveItemById(itemId);
    },

    _updateSearchMatch: function(action) {
        let itemId = action.state.get_string()[0];
        Application.searchMatchManager.setActiveItemById(itemId);
    },

    _activateResult: function() {
        let doc = this._getFirstDocument();
        if (doc)
            Application.documentManager.setActiveItem(doc)
    },

    _getFirstDocument: function() {
        let doc = null;

        let [success, iter] = this._model.get_iter_first();
        if (success) {
            let id = this._model.get_value(iter, Gd.MainColumns.ID);
            doc = Application.documentManager.getItemById(id);
        }

        return doc;
    },

    _addListRenderers: function() {
        let listWidget = this.view.get_generic_view();

        let typeRenderer =
            new Gd.StyledTextRenderer({ xpad: 16 });
        typeRenderer.add_class('dim-label');
        listWidget.add_renderer(typeRenderer, Lang.bind(this,
            function(col, cell, model, iter) {
                let id = model.get_value(iter, Gd.MainColumns.ID);
                let doc = Application.documentManager.getItemById(id);

                typeRenderer.text = doc.typeDescription;
            }));

        let whereRenderer =
            new Gd.StyledTextRenderer({ xpad: 16 });
        whereRenderer.add_class('dim-label');
        listWidget.add_renderer(whereRenderer, Lang.bind(this,
            function(col, cell, model, iter) {
                let id = model.get_value(iter, Gd.MainColumns.ID);
                let doc = Application.documentManager.getItemById(id);

                whereRenderer.text = doc.sourceName;
            }));

        let dateRenderer =
            new Gtk.CellRendererText({ xpad: 32 });
        listWidget.add_renderer(dateRenderer, Lang.bind(this,
            function(col, cell, model, iter) {
                let id = model.get_value(iter, Gd.MainColumns.ID);
                let doc = Application.documentManager.getItemById(id);
                let DAY = 86400000000;

                let now = GLib.DateTime.new_now_local();
                let mtime = GLib.DateTime.new_from_unix_local(doc.mtime);
                let difference = now.difference(mtime);
                let days = Math.floor(difference / DAY);
                let weeks = Math.floor(difference / (7 * DAY));
                let months = Math.floor(difference / (30 * DAY));
                let years = Math.floor(difference / (365 * DAY));

                if (difference < DAY) {
                    dateRenderer.text = mtime.format('%X');
                } else if (difference < 2 * DAY) {
                    dateRenderer.text = _("Yesterday");
                } else if (difference < 7 * DAY) {
                    dateRenderer.text = Gettext.ngettext("%d day ago",
                                                         "%d days ago",
                                                         days).format(days);
                } else if (difference < 14 * DAY) {
                    dateRenderer.text = _("Last week");
                } else if (difference < 28 * DAY) {
                    dateRenderer.text = Gettext.ngettext("%d week ago",
                                                         "%d weeks ago",
                                                         weeks).format(weeks);
                } else if (difference < 60 * DAY) {
                    dateRenderer.text = _("Last month");
                } else if (difference < 360 * DAY) {
                    dateRenderer.text = Gettext.ngettext("%d month ago",
                                                         "%d months ago",
                                                         months).format(months);
                } else if (difference < 730 * DAY) {
                    dateRenderer.text = _("Last year");
                } else {
                    dateRenderer.text = Gettext.ngettext("%d year ago",
                                                         "%d years ago",
                                                         years).format(years);
                }
            }));
    },

    _onSelectionModeRequest: function() {
        Application.selectionController.setSelectionMode(true);
    },

    _onItemActivated: function(widget, id, path) {
        Application.documentManager.setActiveItemById(id);
    },

    _onQueryError: function(manager, message, exception) {
        this._setError(message, exception.message);
    },

    _onQueryStatusChanged: function() {
        let status = this._trackerController.getQueryStatus();

        if (!status) {
            // setup a model if we're not querying
            this.view.set_model(this._model);

            // unfreeze selection
            Application.selectionController.freezeSelection(false);
            this._updateSelection();

            // hide the spinner
            this._spinner.stop();
            this.set_visible_child_name('view');
        } else {
            // save the last selection
            Application.selectionController.freezeSelection(true);

            // if we're querying, clear the model from the view,
            // so that we don't uselessly refresh the rows
            this.view.set_model(null);

            // kick off the spinner
            this._spinner.start();
            this.set_visible_child_name('spinner');
        }
    },

    _setError: function(primary, secondary) {
        this._errorBox.update(primary, secondary);
        this.set_visible_child_name('error');
    },

    _updateSelection: function() {
        let selected = Application.selectionController.getSelection();
        let newSelection = [];

        if (!selected.length)
            return;

        let generic = this.view.get_generic_view();
        let first = true;
        this._model.foreach(Lang.bind(this,
            function(model, path, iter) {
                let id = this._model.get_value(iter, Gd.MainColumns.ID);
                let idIndex = selected.indexOf(id);

                if (idIndex != -1) {
                    this._model.set_value(iter, Gd.MainColumns.SELECTED, true);
                    newSelection.push(id);

                    if (first) {
                        generic.scroll_to_path(path);
                        first = false;
                    }
                }

                if (newSelection.length == selected.length)
                    return true;

                return false;
            }));

        Application.selectionController.setSelection(newSelection);
    },

    _onSelectionModeChanged: function() {
        let selectionMode = Application.selectionController.getSelectionMode();
        this.view.set_selection_mode(selectionMode);
    },

    _onViewSelectionChanged: function() {
        let mode = Application.modeController.getWindowMode();
        if (this._mode != mode)
            return;

        // update the selection on the controller when the view signals a change
        let selectedURNs = Utils.getURNsFromPaths(this.view.get_selection(),
                                                  this._model);
        Application.selectionController.setSelection(selectedURNs);
    },

    _onWindowModeChanged: function() {
        let mode = Application.modeController.getWindowMode();
        if (mode == this._mode)
            this._connectView();
        else
            this._disconnectView();
    },

    _connectView: function() {
        this._edgeHitId = this.view.connect('edge-reached', Lang.bind(this,
            function (view, pos) {
                if (pos == Gtk.PositionType.BOTTOM)
                    this._offsetController.increaseOffset();
            }));
    },

    _disconnectView: function() {
        if (this._edgeHitId != 0) {
            this.view.disconnect(this._edgeHitId);
            this._edgeHitId = 0;
        }
    },

    createToolbar: function(stack) {
        let toolbar = new MainToolbar.OverviewToolbar(stack);
        toolbar.searchbar.connectJS('activate-result',
                                    Lang.bind(this, this._activateResult));
        return toolbar;
    }
});

const View = new Lang.Class({
    Name: 'View',
    Extends: Gtk.Overlay,

    _init: function(window) {
        this._window = window;

        this.parent();

        this._stack = new Gtk.Stack({ visible: true,
                                      homogeneous: true,
                                      transition_type: Gtk.StackTransitionType.CROSSFADE });
        this.add(this._stack);

        // pack the OSD notification widget
        this.add_overlay(Application.notificationManager);

        // now create the actual content widgets
        this._documents = new ViewContainer(WindowMode.WindowMode.DOCUMENTS);
        let label = Application.application.isBooks ? _('Books') : _("Documents");
        this._stack.add_titled(this._documents, 'documents', label);

        this._collections = new ViewContainer(WindowMode.WindowMode.COLLECTIONS);
        this._stack.add_titled(this._collections, 'collections', _("Collections"));

        this._search = new ViewContainer(WindowMode.WindowMode.SEARCH);
        this._stack.add_named(this._search, 'search');

        this.connect('notify::visible-child',
                     Lang.bind(this, this._onVisibleChildChanged));

        this.show();
    },

    _onVisibleChildChanged: function() {
        let visibleChild = this.visible_child;
        let windowMode;

        if (visibleChild == this._collections)
            windowMode = WindowMode.WindowMode.COLLECTIONS;
        else if (visibleChild == this._documents)
            windowMode = WindowMode.WindowMode.DOCUMENTS;
        else
            return;

        Application.modeController.setWindowMode(windowMode);
    },

    _clearPreview: function() {
        if (this._preview) {
            this._preview.destroy();
            this._preview = null;
        }
    },

    _createPreview: function(mode) {
        this._clearPreview();

        let constructor;
        switch (mode) {
        case WindowMode.WindowMode.PREVIEW_EV:
            constructor = EvinceView.EvinceView;
            break;
        case WindowMode.WindowMode.PREVIEW_LOK:
            constructor = LOKView.LOKView;
            break;
        case WindowMode.WindowMode.PREVIEW_EPUB:
            constructor = EPUBView.EPUBView;
            break;
        case WindowMode.WindowMode.EDIT:
            constructor = Edit.EditView;
            break;
        default:
            return;
        }

        this._preview = new constructor(this, this._window);
        this._stack.add_named(this._preview, 'preview');
    },

    createToolbar: function() {
        return this.view.createToolbar(this._stack);
    },

    set windowMode(mode) {
        this._clearPreview();

        let visibleChild;

        switch (mode) {
        case WindowMode.WindowMode.COLLECTIONS:
            visibleChild = this._collections;
            break;
        case WindowMode.WindowMode.DOCUMENTS:
            visibleChild = this._documents;
            break;
        case WindowMode.WindowMode.SEARCH:
            visibleChild = this._search;
            break;
        case WindowMode.WindowMode.PREVIEW_EV:
        case WindowMode.WindowMode.PREVIEW_LOK:
        case WindowMode.WindowMode.PREVIEW_EPUB:
        case WindowMode.WindowMode.EDIT:
            this._createPreview(mode);
            visibleChild = this._preview;
            break;
        default:
            return;
        }

        this._stack.set_visible_child(visibleChild);
        this._window.insert_action_group('view', visibleChild.actionGroup);
    },

    get view() {
        return this._stack.visible_child;
    }
});
