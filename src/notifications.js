/*
 * Copyright (c) 2012 Red Hat, Inc.
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
const Gettext = imports.gettext;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const _ = imports.gettext.gettext;

const Application = imports.application;
const WindowMode = imports.windowMode;

const Mainloop = imports.mainloop;

var DELETE_TIMEOUT = 10; // seconds

var DeleteNotification = class DeleteNotification {
    constructor(docs) {
        this._docs = docs;
        this.widget = new Gtk.Grid({ orientation: Gtk.Orientation.HORIZONTAL,
                                     column_spacing: 12 });

        let msg;

        if (this._docs.length == 1 && this._docs[0].name) {
            // Translators: only one item has been deleted and %s is its name
            msg = (_("“%s” deleted")).format(this._docs[0].name);
        } else {
            // Translators: one or more items might have been deleted, and %d
            // is the count
            msg = Gettext.ngettext("%d item deleted",
                                   "%d items deleted",
                                   this._docs.length).format(this._docs.length);
        }

        let label = new Gtk.Label({ label: msg,
                                    halign: Gtk.Align.START });
        this.widget.add(label);

        let undo = new Gtk.Button({ label: _("Undo"),
                                    valign: Gtk.Align.CENTER });
        this.widget.add(undo);
        undo.connect('clicked', () => {
            this._docs.forEach((doc) => {
                Application.documentManager.addItem(doc);
            });

            this._removeTimeout();
            this.widget.destroy();
        });

        let close = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'window-close-symbolic',
                                                            pixel_size: 16,
                                                            margin_top: 2,
                                                            margin_bottom: 2 }),
                                     valign: Gtk.Align.CENTER,
                                     focus_on_click: false,
                                     relief: Gtk.ReliefStyle.NONE });
        this.widget.add(close);
        close.connect('clicked', this._deleteItems.bind(this));

        Application.notificationManager.addNotification(this);
        this._timeoutId = Mainloop.timeout_add_seconds(DELETE_TIMEOUT, () => {
            this._timeoutId = 0;
            this._deleteItems();
            return false;
        });
    }

    _deleteItems() {
        this._docs.forEach((doc) => {
            doc.trash();
        });

        this._removeTimeout();
        this.widget.destroy();
    }

    _removeTimeout() {
        if (this._timeoutId != 0) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }
}

var PrintNotification = class PrintNotification {
    constructor(printOp, doc) {
        this.widget = null;
        this._printOp = printOp;
        this._doc = doc;

        this._printOp.connect('begin-print', this._onPrintBegin.bind(this));
        this._printOp.connect('status-changed', this._onPrintStatus.bind(this));
    }

    _onPrintBegin() {
        this.widget = new Gtk.Grid({ orientation: Gtk.Orientation.VERTICAL,
                                     row_spacing: 6 });

        this._statusLabel = new Gtk.Label();
        this.widget.add(this._statusLabel);
        this._progressBar = new Gtk.ProgressBar();
        this.widget.add(this._progressBar);

        this._stopButton = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'process-stop-symbolic',
                                                                   pixel_size: 16,
                                                                   margin_top: 2,
                                                                   margin_bottom: 2 }),
                                            margin_start: 12,
                                            valign: Gtk.Align.CENTER
                                            });
        this.widget.attach_next_to(this._stopButton, this._statusLabel,
                                   Gtk.PositionType.RIGHT, 1, 2);
        this._stopButton.connect('clicked', () => {
            this._printOp.cancel();
            this.widget.destroy();
        });

        Application.notificationManager.addNotification(this);
    }

    _onPrintStatus() {
        if (!this.widget)
            return;

        let status = this._printOp.get_status();
        let fraction = this._printOp.get_progress();
        status = _("Printing “%s”: %s").format(this._doc.name, status);

        this._statusLabel.set_text(status);
        this._progressBar.fraction = fraction;

        if (fraction == 1)
            this.widget.destroy();
    }
}

var NotificationManager = GObject.registerClass(class NotificationManager extends Gtk.Revealer {
    _init() {
        super._init({ halign: Gtk.Align.CENTER,
                      valign: Gtk.Align.START });

        let frame = new Gtk.Frame();
        frame.get_style_context().add_class('app-notification');
        this.add(frame);

        this._grid = new Gtk.Grid({ orientation: Gtk.Orientation.VERTICAL,
                                    row_spacing: 6 });

        frame.add(this._grid);
    }

    addNotification(notification) {
        this._grid.add(notification.widget);
        notification.widget.connect('destroy', this._onWidgetDestroy.bind(this));

        this.show_all();
        this.reveal_child = true;
    }

    _onWidgetDestroy() {
        let children = this._grid.get_children();

        if (children.length == 0)
            this.reveal_child = false;
    }
});
