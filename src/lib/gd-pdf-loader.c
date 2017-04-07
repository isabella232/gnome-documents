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

#include <evince-document.h>
#include <evince-view.h>
#include <glib/gi18n.h>

typedef struct {
  GSimpleAsyncResult *result;
  GCancellable *cancellable;
  gulong cancelled_id;

  EvDocument *document;
  gchar *uri;

  gchar *passwd;
  gboolean passwd_tried;
} PdfLoadJob;

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

  g_free (job->uri);
  g_free (job->passwd);

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
    if (g_error_matches (ev_job->error, EV_DOCUMENT_ERROR, EV_DOCUMENT_ERROR_ENCRYPTED)
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

  ev_job = ev_job_load_new (job->uri);
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
}

static void
pdf_load_job_from_uri (PdfLoadJob *job)
{
  GFile *file;

  file = g_file_new_for_uri (job->uri);

  if (!g_file_is_native (file))
    g_assert_not_reached ();

  pdf_load_job_from_pdf (job);
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
