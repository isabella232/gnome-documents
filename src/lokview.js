/*
 * Copyright (c) 2015 Pranav Kant
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
 * Author: Pranav Kant <pranavk@gnome.org>
 *
 */

try {
    const LOKDocView = imports.gi.LOKDocView;
} catch(e) {
    // LOKDocView will be undefined, and we'll
    // use this to warn when LO files can't be opened
}

const Gdk = imports.gi.Gdk;
const Gtk = imports.gi.Gtk;
const _ = imports.gettext.gettext;

const Lang = imports.lang;
const Signals = imports.signals;

const Application = imports.application;
const ErrorBox = imports.errorBox;
const MainToolbar = imports.mainToolbar;
const Preview = imports.preview;
const Documents = imports.documents;

const ZOOM_IN_FACTOR = 1.2;
const ZOOM_OUT_FACTOR = (1.0/ZOOM_IN_FACTOR);

const openDocumentFormats = ['application/vnd.oasis.opendocument.text',
                             'application/vnd.oasis.opendocument.text-template',
                             'application/vnd.oasis.opendocument.text-web',
                             'application/vnd.oasis.opendocument.text-master',
                             'application/vnd.oasis.opendocument.graphics',
                             'application/vnd.oasis.opendocument.graphics-template',
                             'application/vnd.oasis.opendocument.presentation',
                             'application/vnd.oasis.opendocument.presentation-template',
                             'application/vnd.oasis.opendocument.spreadsheet',
                             'application/vnd.oasis.opendocument.spreadsheet-template',
                             'application/vnd.oasis.opendocument.chart',
                             'application/vnd.oasis.opendocument.formula',
                             'application/vnd.oasis.opendocument.database',
                             'application/vnd.oasis.opendocument.image',
                             'application/vnd.openofficeorg.extension',
                             'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                             'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
                             'application/vnd.openxmlformats-officedocument.presentationml.template',
                             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                             'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
                             'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                             'application/vnd.openxmlformats-officedocument.wordprocessingml.template',];


// These are the documents consisting of document parts.
const openDocumentPartFormats = ['application/vnd.oasis.opendocument.presentation',
                                 'application/vnd.oasis.opendocument.presentation-template',
                                 'application/vnd.oasis.opendocument.spreadsheet',
                                 'application/vnd.oasis.opendocument.spreadsheet-template',
                                 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                                 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
                                 'application/vnd.openxmlformats-officedocument.presentationml.template',
                                 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',];

function isAvailable() {
    return (LOKDocView != undefined);
}

function isOpenDocumentPartDocument(mimeType) {
     if (openDocumentPartFormats.indexOf(mimeType) != -1)
         return true;
     return false;
}

function isOpenDocumentFormat(mimeType) {
    if (openDocumentFormats.indexOf(mimeType) != -1)
        return true;
    return false;
}

const LOKView = new Lang.Class({
    Name: 'LOKView',
    Extends: Gtk.Stack,

    _init: function(overlay) {
        this.parent({ homogeneous: true,
                      transition_type: Gtk.StackTransitionType.CROSSFADE });

        this._uri = null;
        this._overlay = overlay;
        this.get_style_context().add_class('documents-scrolledwin');

        this._errorBox = new ErrorBox.ErrorBox();
        this.add_named(this._errorBox, 'error');

        this._sw = new Gtk.ScrolledWindow({hexpand: true,
                                           vexpand: true});

        this._progressBar = new Gtk.ProgressBar({ halign: Gtk.Align.FILL,
                                                  valign: Gtk.Align.START });
        this._progressBar.get_style_context().add_class('osd');
        this._overlay.add_overlay(this._progressBar);

        this.add_named(this._sw, 'view');
        this._createView();

        // create context menu
        let model = this._getPreviewContextMenu();
        this._previewContextMenu = Gtk.Menu.new_from_model(model);
        this._previewContextMenu.attach_to_widget(this._sw, null);

        this.show_all();

        this._zoomIn = Application.application.lookup_action('zoom-in');
        let zoomInId = this._zoomIn.connect('activate', Lang.bind(this,
            function() {
                // FIXME: https://bugs.documentfoundation.org/show_bug.cgi?id=97301
                if (!this._doc)
                    return;
                let zoomLevel = this.view.get_zoom() * ZOOM_IN_FACTOR;
                this.view.set_zoom(zoomLevel);
            }));

        this._zoomOut = Application.application.lookup_action('zoom-out');
        let zoomOutId = this._zoomOut.connect('activate', Lang.bind(this,
            function() {
                // FIXME: https://bugs.documentfoundation.org/show_bug.cgi?id=97301
                if (!this._doc)
                    return;
                let zoomLevel = this.view.get_zoom() * ZOOM_OUT_FACTOR;
                this.view.set_zoom(zoomLevel);
            }));

        this._copy = Application.application.lookup_action('copy');
        let copyId = this._copy.connect('activate', Lang.bind(this, this._onCopyActivated));

        Application.documentManager.connect('load-started',
                                            Lang.bind(this, this._onLoadStarted));
        Application.documentManager.connect('load-error',
                                            Lang.bind(this, this._onLoadError));

        this.connect('destroy', Lang.bind(this,
           function() {
               this._zoomIn.disconnect(zoomInId);
               this._zoomOut.disconnect(zoomOutId);
               this._copy.disconnect(copyId);
           }));
    },

    _onCanZoomInChanged: function() {
        this._zoomIn.enabled = this.view.can_zoom_in;
    },

    _onCanZoomOutChanged: function() {
        this._zoomOut.enabled = this.view.can_zoom_out;
    },

    _onCopyActivated: function() {
        let [selectedText, mimeType] = this.view.copy_selection('text/plain;charset=utf-8');
        let display = Gdk.Display.get_default();
        let clipboard = Gtk.Clipboard.get_default(display);

        clipboard.set_text(selectedText, selectedText.length);
    },

    _onLoadStarted: function(manager, doc) {
        if (doc.viewType != Documents.ViewType.LOK)
            return;
        if (!isAvailable())
            return;
        this._doc = doc;
        this._copy.enabled = false;
        this.view.open_document(doc.uri, "{}", null, Lang.bind(this, this.open_document_cb));
        this._progressBar.show();
    },

    _onLoadError: function(manager, doc, message, exception) {
        if (doc.viewType != Documents.ViewType.LOK)
            return;
        //FIXME we should hide controls
        this._setError(message, exception.message);
    },

    open_document_cb: function(res, doc) {
        // TODO: Call _finish and check failure
        this._progressBar.hide();
        this.set_visible_child_name('view');
        this.view.set_edit(false);
    },

    reset: function () {
        if (!this.view)
            return;

        // FIXME: https://bugs.documentfoundation.org/show_bug.cgi?id=97235
        if (this._doc)
            this.view.reset_view();
        this.set_visible_child_full('view', Gtk.StackTransitionType.NONE);
        this._copy.enabled = false;
    },

    _createView: function() {
        if (isAvailable()) {
            this.view = LOKDocView.View.new(null, null, null);
            this._sw.add(this.view);
            this.view.show();
            this.view.connect('button-press-event', Lang.bind(this, this._onButtonPressEvent));
            this.view.connect('load-changed', Lang.bind(this, this._onProgressChanged));
            this.view.connect('text-selection', Lang.bind(this, this._onTextSelection));
            this.view.connect('notify::can-zoom-in', Lang.bind(this, this._onCanZoomInChanged));
            this.view.connect('notify::can-zoom-out', Lang.bind(this, this._onCanZoomOutChanged));
        }

        this._navControls = new Preview.PreviewNavControls(this, this._overlay);
        this.set_visible_child_full('view', Gtk.StackTransitionType.NONE);
    },

    _getPreviewContextMenu: function() {
        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/Documents/ui/preview-context-menu.ui');
        return builder.get_object('preview-context-menu');
    },

    _onButtonPressEvent: function(widget, event) {
        let button = event.get_button()[1];

        if (button == 3) {
            let time = event.get_time();
            this._previewContextMenu.popup(null, null, null, button, time);
            return true;
        }

        return false;
   },

    _onProgressChanged: function() {
        this._progressBar.fraction = this.view.load_progress;
    },

    _onTextSelection: function(hasSelection) {
        this._copy.enabled = hasSelection;
    },

    _setError: function(primary, secondary) {
        this._errorBox.update(primary, secondary);
        this.set_visible_child_name('error');
    },

    goPrev: function() {
        let currentPart = this.view.get_part();
        currentPart -= 1;
        if (currentPart < 0)
            return;
        this.view.set_part(currentPart);
        // FIXME: https://bugs.documentfoundation.org/show_bug.cgi?id=97236
        this.view.reset_view();
    },

    goNext: function() {
        let totalParts  = this.view.get_parts();
        let currentPart = this.view.get_part();
        currentPart += 1;
        if (currentPart > totalParts)
            return;
        this.view.set_part(currentPart);
        // FIXME: https://bugs.documentfoundation.org/show_bug.cgi?id=97236
        this.view.reset_view();
    },

    get hasPages() {
        return isOpenDocumentPartDocument(this._doc.mimeType);
    },

    get page() {
        return this.view.get_part();
    },

    get numPages() {
        return this.view.get_parts();
    }
});
Signals.addSignalMethods(LOKView.prototype);

const LOKViewToolbar = new Lang.Class({
    Name: 'LOKViewToolbar',
    Extends: MainToolbar.MainToolbar,

    _init: function(lokView) {
        this._lokView = lokView;

        this.parent();
        this.toolbar.set_show_close_button(true);

        this._gearMenu = Application.application.lookup_action('gear-menu');
        this._gearMenu.enabled = true;

        this._lokView._zoomIn.enabled = true;
        this._lokView._zoomOut.enabled = true;

        // back button, on the left of the toolbar
        let backButton = this.addBackButton();
        backButton.connect('clicked', Lang.bind(this,
            function() {
                Application.documentManager.setActiveItem(null);
                Application.modeController.goBack();
            }));

        // menu button, on the right of the toolbar
        let lokViewMenu = this._getLOKViewMenu();
        let menuButton = new Gtk.MenuButton({ image: new Gtk.Image ({ icon_name: 'open-menu-symbolic' }),
                                              menu_model: lokViewMenu,
                                              action_name: 'app.gear-menu' });
        this.toolbar.pack_end(menuButton);

        // search button, on the right of the toolbar
        this.addSearchButton();

        this._setToolbarTitle();
        this.toolbar.show_all();
    },

    createSearchbar: function() {
    },

    _getLOKViewMenu: function() {
        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/Documents/ui/preview-menu.ui');
        let menu = builder.get_object('preview-menu');
        let section = builder.get_object('open-section');

        let doc = Application.documentManager.getActiveItem();
        if (doc && doc.defaultAppName) {
            section.remove(0);
            section.prepend(_("Open with %s").format(doc.defaultAppName), 'app.open-current');
        }

        // No edit support yet
        section.remove(1);
        // No print support yet
        section.remove(1);
        // No present support yet
        section.remove(1);

        // No rotate support
        section = builder.get_object('rotate-section');
        section.remove(0);
        section.remove(0);

        return menu;
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
