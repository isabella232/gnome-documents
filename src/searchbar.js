/*
 * Copyright (c) 2011 Red Hat, Inc.
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

const Gd = imports.gi.Gd;
const Gdk = imports.gi.Gdk;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;

const Lang = imports.lang;

const Application = imports.application;
const Manager = imports.manager;
const Utils = imports.utils;

const Searchbar = new Lang.Class({
    Name: 'Searchbar',
    Extends: Gtk.SearchBar,

    _init: function() {
        this.searchChangeBlocked = false;

        this.parent();

        // subclasses will create this.searchEntry
        let searchWidget = this.createSearchWidget();

        this.add(searchWidget);
        this.connect_entry(this.searchEntry);

        this.searchEntry.connect('search-changed', Lang.bind(this,
            function() {
                if (this.searchChangeBlocked)
                    return;

                this.entryChanged();
            }));
        this.connect('notify::search-mode-enabled', Lang.bind(this,
            function() {
                let searchEnabled = this.search_mode_enabled;
                Application.application.change_action_state('search', GLib.Variant.new('b', searchEnabled));
            }));

        // connect to the search action state for visibility
        let searchStateId = Application.application.connect('action-state-changed::search',
            Lang.bind(this, this._onActionStateChanged));
        this._onActionStateChanged(Application.application, 'search', Application.application.get_action_state('search'));

        this.connect('destroy', Lang.bind(this,
            function() {
                Application.application.disconnect(searchStateId);
                Application.application.change_action_state('search', GLib.Variant.new('b', false));
            }));

        this.show_all();
    },

    _onActionStateChanged: function(source, actionName, state) {
        if (state.get_boolean())
            this.reveal();
        else
            this.conceal();
    },

    createSearchWidget: function() {
        log('Error: Searchbar implementations must override createSearchWidget');
    },

    entryChanged: function() {
        log('Error: Searchbar implementations must override entryChanged');
    },

    handleEvent: function(event) {
        // Skip if the search bar is shown and the focus is elsewhere
        if (this.search_mode_enabled && !this.searchEntry.is_focus)
            return false;

        let keyval = event.get_keyval()[1];
        if (this.search_mode_enabled && keyval == Gdk.KEY_Return) {
            this.emitJS('activate-result');
            return true;
        }

        let retval = this.handle_event(event);
        if (retval == Gdk.EVENT_STOP)
            this.searchEntry.grab_focus_without_selecting();
        return retval;
    },

    reveal: function() {
        this.search_mode_enabled = true;
    },

    conceal: function() {
        this.search_mode_enabled = false;

        // clear all the search properties when hiding the entry
        this.searchEntry.set_text('');
    }
});
Utils.addJSSignalMethods(Searchbar.prototype);

const Dropdown = new Lang.Class({
    Name: 'Dropdown',
    Extends: Gtk.Popover,

    _init: function() {
        this.parent({ position: Gtk.PositionType.BOTTOM });

        let grid = new Gtk.Grid({ orientation: Gtk.Orientation.HORIZONTAL,
                                  row_homogeneous: true,
                                  visible: true });
        this.add(grid);

        [Application.sourceManager,
         Application.searchTypeManager,
         Application.searchMatchManager].forEach(Lang.bind(this, function(manager) {
             let model = new Manager.BaseModel(manager);

             // HACK: see https://bugzilla.gnome.org/show_bug.cgi?id=733977
             let popover = new Gtk.Popover();
             popover.bind_model(model, 'view');
             let w = popover.get_child();
             w.reparent(grid);
             w.valign = Gtk.Align.START;
             w.vexpand = true;
             popover.destroy();
         }));
    }
});

const OverviewSearchbar = new Lang.Class({
    Name: 'OverviewSearchbar',
    Extends: Searchbar,

    _init: function() {
        this.parent();

        let sourcesId = Application.sourceManager.connect('active-changed',
            Lang.bind(this, this._onActiveSourceChanged));
        let searchTypeId = Application.searchTypeManager.connect('active-changed',
            Lang.bind(this, this._onActiveTypeChanged));
        let searchMatchId = Application.searchMatchManager.connect('active-changed',
            Lang.bind(this, this._onActiveMatchChanged));
        let collectionId = Application.documentManager.connect('active-collection-changed',
            Lang.bind(this, this._onActiveCollectionChanged));

        this._onActiveSourceChanged();
        this._onActiveTypeChanged();
        this._onActiveMatchChanged();

        this.searchEntry.set_text(Application.searchController.getString());
        this.connect('destroy', Lang.bind(this,
            function() {
                Application.sourceManager.disconnect(sourcesId);
                Application.searchTypeManager.disconnect(searchTypeId);
                Application.searchMatchManager.disconnect(searchMatchId);
                Application.documentManager.disconnect(collectionId);
            }));
    },

    createSearchWidget: function() {
        // create the search entry
        this.searchEntry = new Gd.TaggedEntry({ width_request: 500 });
        this.searchEntry.connect('tag-clicked',
            Lang.bind(this, this._onTagClicked));
        this.searchEntry.connect('tag-button-clicked',
            Lang.bind(this, this._onTagButtonClicked));

        this._sourceTag = new Gd.TaggedEntryTag();
        this._typeTag = new Gd.TaggedEntryTag();
        this._matchTag = new Gd.TaggedEntryTag();

        // connect to search string changes in the controller
        this._searchChangedId = Application.searchController.connect('search-string-changed',
            Lang.bind(this, this._onSearchStringChanged));

        this.searchEntry.connect('destroy', Lang.bind(this,
            function() {
                Application.searchController.disconnect(this._searchChangedId);
            }));

        // create the dropdown button
        let dropdown = new Dropdown();
        this._dropdownButton = new Gtk.MenuButton({ popover: dropdown });

        let box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL,
                                halign: Gtk.Align.CENTER });
        box.get_style_context().add_class('linked');

        box.add(this.searchEntry);
        box.add(this._dropdownButton);
        box.show_all();

        return box;
    },

    entryChanged: function() {
        let currentText = this.searchEntry.get_text();

        Application.searchController.disconnect(this._searchChangedId);
        Application.searchController.setString(currentText);

        // connect to search string changes in the controller
        this._searchChangedId = Application.searchController.connect('search-string-changed',
            Lang.bind(this, this._onSearchStringChanged));
    },

    _onSearchStringChanged: function(controller, string) {
        this.searchEntry.set_text(string);
    },

    _onActiveCollectionChanged: function(manager, collection) {
        if (!collection)
            return;

        let searchType = Application.searchTypeManager.getActiveItem();

        if (Application.searchController.getString() != '' ||
            searchType.id != 'all') {
            Application.searchTypeManager.setActiveItemById('all');
            this.searchEntry.set_text('');
        }
    },

    _onActiveChangedCommon: function(id, manager, tag) {
        let item = manager.getActiveItem();

        if (item.id == 'all') {
            this.searchEntry.remove_tag(tag);
        } else {
            tag.set_label(item.name);
            this.searchEntry.add_tag(tag);
        }

        this.searchEntry.grab_focus_without_selecting();
    },

    _onActiveSourceChanged: function() {
        this._onActiveChangedCommon('source', Application.sourceManager, this._sourceTag);
    },

    _onActiveTypeChanged: function() {
        this._onActiveChangedCommon('type', Application.searchTypeManager, this._typeTag);
    },

    _onActiveMatchChanged: function() {
        this._onActiveChangedCommon('match', Application.searchMatchManager, this._matchTag);
    },

    _onTagButtonClicked: function(entry, tag) {
        let manager = null;

        if (tag == this._matchTag) {
            manager = Application.searchMatchManager;
        } else if (tag == this._typeTag) {
            manager = Application.searchTypeManager;
        } else if (tag == this._sourceTag) {
            manager = Application.sourceManager;
        }

        if (manager) {
            manager.setActiveItemById('all');
        }
    },

    _onTagClicked: function() {
        this._dropdownButton.set_active(true);
    },

    conceal: function() {
        this._dropdownButton.set_active(false);

        Application.searchTypeManager.setActiveItemById('all');
        Application.searchMatchManager.setActiveItemById('all');
        Application.sourceManager.setActiveItemById('all');

        this.parent();
    }
});
