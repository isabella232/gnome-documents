/*
 * Copyright (c) 2011, 2012, 2013, 2015 Red Hat, Inc.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by 
 * the Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Lesser General Public 
 * License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License 
 * along with this program; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 * Author: Cosimo Cecchi <cosimoc@redhat.com>
 *
 */

#include "gd-pdf-loader.h"
#include "gd-utils.h"

#include <string.h>
#include <gdk/gdkx.h>
#include <gtk/gtk.h>
#include <evince-document.h>
#include <evince-view.h>
#include <glib/gstdio.h>
#include <glib/gi18n.h>

typedef struct {
  GSimpleAsyncResult *result;
  GCancellable *cancellable;
  gulong cancelled_id;

  EvDocument *document;
  gchar *uri;
  gchar *pdf_path;
  GPid unoconv_pid;

  gchar *passwd;
  gboolean passwd_tried;

  GFile *download_file;

  guint64 pdf_cache_mtime;
  guint64 original_file_mtime;

  gboolean unlink_cache;
  gboolean from_old_cache;
} PdfLoadJob;

static void pdf_load_job_from_openoffice (PdfLoadJob *job);
static void pdf_load_job_openoffice_refresh_cache (PdfLoadJob *job);

/* --------------------------- utils -------------------------------- */

static gchar **
query_supported_document_types (void)
{
  GList *infos, *l;
  gchar **retval = NULL;
  GPtrArray *array;
  EvTypeInfo *info;
  gint idx;

  infos = ev_backends_manager_get_all_types_info ();

  if (infos == NULL)
    return NULL;

  array = g_ptr_array_new ();

  for (l = infos; l != NULL; l = l->next) {
    info = l->data;

    for (idx = 0; info->mime_types[idx] != NULL; idx++)
      g_ptr_array_add (array, g_strdup (info->mime_types[idx]));
  }

  g_ptr_array_add (array, NULL);
  retval = (gchar **) g_ptr_array_free (array, FALSE);

  return retval;
}

static gboolean
content_type_is_native (const gchar *content_type)
{
  gchar **native_types;
  gint idx;
  gboolean found = FALSE;

  native_types = query_supported_document_types ();

  for (idx = 0; native_types[idx] != NULL; idx++) {
    found = g_content_type_is_a (content_type, native_types[idx]);
    if (found)
      break;
  }

  g_strfreev (native_types);

  return found;
}

/* ----------------------- load job ------------------------------ */

static void
pdf_load_job_free (PdfLoadJob *job)
{
  if (job->cancellable != NULL) {
    g_cancellable_disconnect (job->cancellable, job->cancelled_id);
    job->cancelled_id = 0;
  }

  g_clear_object (&job->document);
  g_clear_object (&job->result);
  g_clear_object (&job->cancellable);
  g_clear_object (&job->download_file);

  g_free (job->uri);
  g_free (job->passwd);

  if (job->pdf_path != NULL) {
    if (job->unlink_cache)
      g_unlink (job->pdf_path);

    g_free (job->pdf_path);
  }

  if (job->unoconv_pid != -1) {
    kill (job->unoconv_pid, SIGKILL);
    job->unoconv_pid = -1;
  }

  g_slice_free (PdfLoadJob, job);
}

static PdfLoadJob *
pdf_load_job_new (GSimpleAsyncResult *result,
                  const gchar *uri,
                  const gchar *passwd,
                  GCancellable *cancellable)
{
  PdfLoadJob *retval;

  retval = g_slice_new0 (PdfLoadJob);
  retval->result = g_object_ref (result);
  retval->unoconv_pid = -1;
  retval->unlink_cache = FALSE;
  retval->from_old_cache = FALSE;

  if (uri != NULL)
    retval->uri = g_strdup (uri);
  if (passwd != NULL)
    retval->passwd = g_strdup (passwd);
  if (cancellable != NULL)
    retval->cancellable = g_object_ref (cancellable);

  return retval;
}

static void
pdf_load_job_complete_error (PdfLoadJob *job,
                             GError *error)
{
    g_simple_async_result_take_error (job->result, error);
    g_simple_async_result_complete_in_idle (job->result);

    job->unlink_cache = TRUE;
    pdf_load_job_free (job);
}

static void
pdf_load_job_complete_success (PdfLoadJob *job)
{
  EvDocumentModel *doc_model = ev_document_model_new_with_document (job->document);

  g_simple_async_result_set_op_res_gpointer (job->result, doc_model, NULL);
  g_simple_async_result_complete_in_idle (job->result);

  pdf_load_job_free (job);
}

static void
pdf_load_job_force_refresh_cache (PdfLoadJob *job)
{
  if (job->from_old_cache)
    job->from_old_cache = FALSE;

  pdf_load_job_openoffice_refresh_cache (job);
}

static void
ev_load_job_cancelled (EvJob *ev_job,
                       gpointer user_data)
{
  PdfLoadJob *job = user_data;

  if (job->cancelled_id > 0) {
    g_cancellable_disconnect (job->cancellable, job->cancelled_id);
    job->cancelled_id = 0;
  }

  pdf_load_job_complete_error (job,
                               g_error_new_literal (G_IO_ERROR, G_IO_ERROR_CANCELLED,
                                                    "Operation cancelled"));
}

static void
ev_load_job_done (EvJob *ev_job,
                  gpointer user_data)
{
  PdfLoadJob *job = user_data;

  if (job->cancelled_id > 0) {
    g_cancellable_disconnect (job->cancellable, job->cancelled_id);
    job->cancelled_id = 0;
  }

  if (ev_job_is_failed (ev_job) || (ev_job->document == NULL)) {
    if (job->from_old_cache) {
      pdf_load_job_force_refresh_cache (job);
    } else if (g_error_matches (ev_job->error, EV_DOCUMENT_ERROR, EV_DOCUMENT_ERROR_ENCRYPTED)
               && job->passwd != NULL
               && !job->passwd_tried) {
      /* EvJobLoad tries using the password only after the job has
       * failed once.
       */
      ev_job_scheduler_push_job (ev_job, EV_JOB_PRIORITY_NONE);
      job->passwd_tried = TRUE;
    } else {
      pdf_load_job_complete_error (job, (ev_job->error != NULL) ? 
                                   g_error_copy (ev_job->error) :
                                   g_error_new_literal (G_IO_ERROR,
                                                        G_IO_ERROR_FAILED,
                                                        _("Unable to load the document")));
    }

    return;
  }

  job->document = g_object_ref (ev_job->document);
  pdf_load_job_complete_success (job);
}

static gboolean
pdf_load_cancel_in_idle (gpointer user_data)
{
  EvJob *ev_job = user_data;
  ev_job_cancel (ev_job);
  return FALSE;
}

static void
pdf_load_cancelled_cb (GCancellable *cancellable,
                       EvJob *ev_job)
{
  g_idle_add (pdf_load_cancel_in_idle, ev_job);
}

static void
pdf_load_job_from_pdf (PdfLoadJob *job)
{
  EvJob *ev_job;
  gchar *uri = NULL;
  GFile *file;

  if (job->pdf_path != NULL) {
    file = g_file_new_for_path (job->pdf_path);
    uri = g_file_get_uri (file);
    g_object_unref (file);
  }

  ev_job = ev_job_load_new ((uri != NULL) ? (uri) : (job->uri));
  if (job->passwd != NULL)
    ev_job_load_set_password (EV_JOB_LOAD (ev_job), job->passwd);

  g_signal_connect (ev_job, "cancelled",
                    G_CALLBACK (ev_load_job_cancelled), job);
  g_signal_connect (ev_job, "finished",
                    G_CALLBACK (ev_load_job_done), job);

  if (job->cancellable != NULL)
    job->cancelled_id =
      g_cancellable_connect (job->cancellable,
                             G_CALLBACK (pdf_load_cancelled_cb), ev_job, NULL);

  ev_job_scheduler_push_job (ev_job, EV_JOB_PRIORITY_NONE);

  g_object_unref (ev_job);
  g_free (uri);
}

static void
cache_set_attributes_ready_cb (GObject *source,
                               GAsyncResult *res,
                               gpointer user_data)
{
  PdfLoadJob *job = user_data;
  GError *error = NULL;
  GFileInfo *out_info = NULL;

  g_file_set_attributes_finish (G_FILE (source), res, &out_info, &error);

  if (error != NULL) {
    /* just emit a warning here; setting the mtime is a precaution
     * against the cache file being externally modified after it has been
     * created, which is unlikely. Invalidate the cache immediately after
     * loading the file in this case.
     */
    job->unlink_cache = TRUE;

    g_warning ("Cannot set mtime on the cache file; cache will not be valid "
               "after the file has been viewed. Error: %s", error->message);
    g_error_free (error);
  }

  if (out_info != NULL)
    g_object_unref (out_info);

  pdf_load_job_from_pdf (job);
}

static void
pdf_load_job_cache_set_attributes (PdfLoadJob *job)
{
  GFileInfo *info;
  GFile *file;

  if (job->download_file != NULL)
    {
      gchar *path;

      path = g_file_get_path (job->download_file);

      /* In case the downloaded file is not the final PDF, then we
       * need to convert it.
       */
      if (g_strcmp0 (path, job->pdf_path) != 0)
        {
          /* make the file private */
          g_chmod (path, 0600);
          job->uri = g_file_get_uri (job->download_file);
          pdf_load_job_from_openoffice (job);
          g_free (path);
          return;
        }

      g_clear_object (&job->download_file);
      g_free (path);
    }

  /* make the file private */
  g_chmod (job->pdf_path, 0600);

  file = g_file_new_for_path (job->pdf_path);
  info = g_file_info_new ();

  g_file_info_set_attribute_uint64 (info, G_FILE_ATTRIBUTE_TIME_MODIFIED,
                                    job->original_file_mtime);
  g_file_set_attributes_async (file, info,
                               G_FILE_QUERY_INFO_NONE,
                               G_PRIORITY_DEFAULT,
                               job->cancellable,
                               cache_set_attributes_ready_cb,
                               job);

  g_object_unref (info);
  g_object_unref (file);
}

static void
unoconv_cancelled_cb (GCancellable *cancellable,
                      gpointer user_data)
{
  PdfLoadJob *job = user_data;

  /* job->unoconv_pid will be reset by unoconv_child_watch_cb */
  if (job->unoconv_pid != -1)
    kill (job->unoconv_pid, SIGKILL);
}

static void
unoconv_child_watch_cb (GPid pid,
                        gint status,
                        gpointer user_data)
{
  PdfLoadJob *job = user_data;

  if (job->cancellable != NULL) {
    g_cancellable_disconnect (job->cancellable, job->cancelled_id);
    job->cancelled_id = 0;
  }

  g_spawn_close_pid (pid);
  job->unoconv_pid = -1;

  /* We need to clean up the downloaded file (if any) that was
   * converted.
   */
  if (job->download_file != NULL)
    {
      g_file_delete (job->download_file, NULL, NULL);
      g_clear_object (&job->download_file);
    }

  if (g_cancellable_is_cancelled (job->cancellable)) {
    pdf_load_job_complete_error 
      (job, 
       g_error_new_literal (G_IO_ERROR, G_IO_ERROR_CANCELLED,
                            "Operation cancelled"));

    return;
  }

  pdf_load_job_cache_set_attributes (job);
}

static void
openoffice_missing_unoconv_ready_cb (GObject *source,
                                     GAsyncResult *res,
                                     gpointer user_data)
{
  PdfLoadJob *job = user_data;
  GError *error = NULL;

  g_dbus_connection_call_finish (G_DBUS_CONNECTION (source), res, &error);
  if (error != NULL) {
    GError *local_error;

    /* can't install unoconv with packagekit - nothing else we can do */
    g_warning ("unoconv not found, and PackageKit failed to install it with error %s",
               error->message);
    local_error = g_error_new_literal (G_IO_ERROR, G_IO_ERROR_NOT_FOUND,
                                       _("LibreOffice is required to view this document"));

    pdf_load_job_complete_error (job, local_error);
    g_error_free (error);
    return;
  }

  /* now that we have unoconv installed, try again refreshing the cache */
  pdf_load_job_openoffice_refresh_cache (job);
}

static void
pdf_load_job_openoffice_missing_unoconv (PdfLoadJob *job)
{
  GApplication *app = g_application_get_default ();
  GtkWidget *widget = GTK_WIDGET (gtk_application_get_active_window (GTK_APPLICATION (app)));
  GDBusConnection *connection = g_application_get_dbus_connection (app);
  guint xid = 0;
  GdkWindow *gdk_window;
  const gchar *unoconv_path[2];

  gdk_window = gtk_widget_get_window (widget);
  if (gdk_window != NULL)
    xid = GDK_WINDOW_XID (gdk_window);

  unoconv_path[0] = "/usr/bin/unoconv";
  unoconv_path[1] = NULL;

  g_dbus_connection_call (connection,
                          "org.freedesktop.PackageKit",
                          "/org/freedesktop/PackageKit",
                          "org.freedesktop.PackageKit.Modify",
                          "InstallProvideFiles",
                          g_variant_new ("(u^ass)",
                                         xid,
                                         unoconv_path,
                                         "hide-confirm-deps"),
                          NULL, G_DBUS_CALL_FLAGS_NONE,
                          G_MAXINT,
                          job->cancellable,
                          openoffice_missing_unoconv_ready_cb,
                          job);
}

static void
pdf_load_job_openoffice_refresh_cache (PdfLoadJob *job)
{
  gchar *doc_path, *cmd, *quoted_path, *unoconv_path;
  GFile *file;
  gint argc;
  GPid pid;
  gchar **argv = NULL;
  GError *error = NULL;

  unoconv_path = g_find_program_in_path ("unoconv");
  if (unoconv_path == NULL)
    {
      pdf_load_job_openoffice_missing_unoconv (job);
      return;
    }

  g_free (unoconv_path);

  /* build the temporary PDF file path */
  file = g_file_new_for_uri (job->uri);
  doc_path = g_file_get_path (file);
  quoted_path = g_shell_quote (doc_path);

  g_object_unref (file);
  g_free (doc_path);

  /* call into the unoconv executable to convert the OpenOffice document
   * to the temporary PDF.
   */
  cmd = g_strdup_printf ("unoconv -f pdf -o %s %s", job->pdf_path, quoted_path);
  g_shell_parse_argv (cmd, &argc, &argv, &error);

  g_free (cmd);
  g_free (quoted_path);

  if (error != NULL) {
    pdf_load_job_complete_error (job, error);
    return;
  }

  g_spawn_async (NULL, argv, NULL,
                 G_SPAWN_DO_NOT_REAP_CHILD |
                 G_SPAWN_SEARCH_PATH,
                 NULL, NULL,
                 &pid, &error);

  g_strfreev (argv);

  if (error != NULL) {
    pdf_load_job_complete_error (job, error);
    return;
  }

  /* now watch when the unoconv child process dies */
  g_child_watch_add (pid, unoconv_child_watch_cb, job);
  job->unoconv_pid = pid;

  if (job->cancellable != NULL)
    job->cancelled_id = g_cancellable_connect (job->cancellable, G_CALLBACK (unoconv_cancelled_cb), job, NULL);
}

static void
openoffice_cache_query_info_ready_cb (GObject *source,
                                      GAsyncResult *res,
                                      gpointer user_data)
{
  PdfLoadJob *job = user_data;
  GError *error = NULL;
  GFileInfo *info;

  info = g_file_query_info_finish (G_FILE (source), res, &error);

  if (error != NULL) {
    /* create/invalidate cache */
    pdf_load_job_openoffice_refresh_cache (job);

    g_error_free (error);
    return;
  }

  job->pdf_cache_mtime = 
    g_file_info_get_attribute_uint64 (info, 
                                      G_FILE_ATTRIBUTE_TIME_MODIFIED);

  if (job->original_file_mtime != job->pdf_cache_mtime) {
    pdf_load_job_openoffice_refresh_cache (job);
  } else {
    job->from_old_cache = TRUE;

    /* load the cached file */
    pdf_load_job_from_pdf (job);
  }

  g_object_unref (info);
}

static void
openoffice_cache_query_info_original_ready_cb (GObject *source,
                                               GAsyncResult *res,
                                               gpointer user_data)
{
  PdfLoadJob *job = user_data;
  GError *error = NULL;
  GFileInfo *info;
  guint64 mtime;
  gchar *pdf_path, *tmp_name, *tmp_path;
  GFile *cache_file;

  info = g_file_query_info_finish (G_FILE (source), res, &error);

  if (error != NULL) {
    /* try to create the cache anyway - if the source file
     * is really not readable we'll fail again soon.
     */
    pdf_load_job_openoffice_refresh_cache (job);

    g_error_free (error);
    return;
  }

  /* If we are converting a downloaded file then we already know its
   * mtime. Moreover, we we don't want to find the mtime of the
   * temporary file.
   */
  if (job->original_file_mtime == 0)
    job->original_file_mtime = mtime =
      g_file_info_get_attribute_uint64 (info, G_FILE_ATTRIBUTE_TIME_MODIFIED);

  g_object_unref (info);

  tmp_path = g_build_filename (g_get_user_cache_dir (), "gnome-documents", NULL);
  g_mkdir_with_parents (tmp_path, 0700);

  /* If we are converting a downloaded file then we already know its
   * location in the cache. Moreover, we we don't want to hash the
   * temporary file.
   */
  if (job->pdf_path == NULL)
    {
      tmp_name = g_strdup_printf ("gnome-documents-%u.pdf", g_str_hash (job->uri));
      job->pdf_path = pdf_path =
        g_build_filename (tmp_path, tmp_name, NULL);
      g_free (tmp_name);
    }

  g_free (tmp_path);

  cache_file = g_file_new_for_path (pdf_path);
  g_file_query_info_async (cache_file,
                           G_FILE_ATTRIBUTE_TIME_MODIFIED,
                           G_FILE_QUERY_INFO_NONE,
                           G_PRIORITY_DEFAULT,
                           job->cancellable,
                           openoffice_cache_query_info_ready_cb,
                           job);

  g_object_unref (cache_file);
}

static void
pdf_load_job_from_openoffice (PdfLoadJob *job)
{
  GFile *original_file;

  original_file = g_file_new_for_uri (job->uri);
  g_file_query_info_async (original_file,
                           G_FILE_ATTRIBUTE_TIME_MODIFIED,
                           G_FILE_QUERY_INFO_NONE,
                           G_PRIORITY_DEFAULT,
                           job->cancellable,
                           openoffice_cache_query_info_original_ready_cb,
                           job);

  g_object_unref (original_file);
}

static void
query_info_ready_cb (GObject *obj,
                     GAsyncResult *res,
                     gpointer user_data)
{
  PdfLoadJob *job = user_data;
  GError *error = NULL;
  GFileInfo *info;
  const gchar *content_type;

  info = g_file_query_info_finish (G_FILE (obj),
                                   res, &error);

  if (error != NULL) {
    pdf_load_job_complete_error (job, error);
    return;
  }

  content_type = g_file_info_get_content_type (info);

  if (content_type_is_native (content_type))
    pdf_load_job_from_pdf (job);
  else
    pdf_load_job_from_openoffice (job);

  g_object_unref (info);
}

static void
pdf_load_job_from_regular_file (PdfLoadJob *job)
{
  GFile *file;

  file = g_file_new_for_uri (job->uri);
  g_file_query_info_async (file,
                           G_FILE_ATTRIBUTE_STANDARD_CONTENT_TYPE,
                           G_FILE_QUERY_INFO_NONE,
                           G_PRIORITY_DEFAULT,
                           job->cancellable,
                           query_info_ready_cb,
                           job);

  g_object_unref (file);
}

static void
pdf_load_job_from_uri (PdfLoadJob *job)
{
  GFile *file;

  file = g_file_new_for_uri (job->uri);

  if (!g_file_is_native (file))
    g_assert_not_reached ();

  pdf_load_job_from_regular_file (job);
  g_object_unref (file);
}

static void
pdf_load_job_start (PdfLoadJob *job)
{
  pdf_load_job_from_uri (job);
}

/**
 * gd_pdf_loader_load_uri_async:
 * @uri:
 * @passwd: (allow-none):
 * @cancellable: (allow-none):
 * @callback:
 * @user_data:
 */
void
gd_pdf_loader_load_uri_async (const gchar *uri,
                              const gchar *passwd,
                              GCancellable *cancellable,
                              GAsyncReadyCallback callback,
                              gpointer user_data)
{
  PdfLoadJob *job;
  GSimpleAsyncResult *result;

  result = g_simple_async_result_new (NULL, callback, user_data,
                                      gd_pdf_loader_load_uri_async);

  job = pdf_load_job_new (result, uri, passwd, cancellable);

  pdf_load_job_start (job);

  g_object_unref (result);
}

/**
 * gd_pdf_loader_load_uri_finish:
 * @res:
 * @error: (allow-none) (out):
 *
 * Returns: (transfer full):
 */
EvDocumentModel *
gd_pdf_loader_load_uri_finish (GAsyncResult *res,
                               GError **error)
{
  EvDocumentModel *retval;

  if (g_simple_async_result_propagate_error (G_SIMPLE_ASYNC_RESULT (res), error))
    return NULL;

  retval = g_simple_async_result_get_op_res_gpointer (G_SIMPLE_ASYNC_RESULT (res));
  return retval;
}
