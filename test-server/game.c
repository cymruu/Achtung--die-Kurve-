struct seg{
	float x1, y1, x2, y2;
	int uid;		// van welke user dit segment is (miss handig?)
	struct seg *nxt;
};

struct game{
	int n, w, h, 		// number of players, width, height
		nmin, nmax, 	// desired number of players
		tilew, tileh, 	// tile width & height
		htiles, vtiles, // number of horizontal tiles & vertical tiles
		state;			// game state, 0: waiting for more players, 1: 
	double t;			// start time
	struct seg **seg;	// two dimensional array of linked lists, one for each tile
	struct usern *usrn;	// user list
	struct game *nxt;
} *headgame;

struct user{
	int id;
	struct game *gm;
	char *name;
	char **sb;			// sendbuffer
	int sbat;			// sendbuffer at
	struct libwebsocket *wsi; // mag dit?
};

struct usern{			// user node
	struct user *usr;
	struct usern *nxt;
};

#define EPS 0.001

static int usrc= 0;	// user count

// safe malloc, exit(500) on error
void* smalloc(size_t size){
	void* a= malloc(size);
	if(a==0){
		fprintf(stderr, "malloc failed, exiting..\n");
		exit(500);
	}
	return a;
}

// returns "" on error
char* getjsonstr(cJSON *json, char* obj){
	json= cJSON_GetObjectItem(json,obj);
	if(json==0){
		if(debug) fprintf(stderr, "json parse error! object '%s' not found!\n", obj);
		return "";
	}
	return json->valuestring;
}
// returns -1 on error
int getjsonint(cJSON *json, char* obj){
	json= cJSON_GetObjectItem(json,obj);
	if(json==0){
		if(debug) fprintf(stderr, "json parse error! object '%s' not found!\n", obj);
		return -1;
	}
	return json->valueint;
}

cJSON* jsoncreate(char *mode){
	cJSON *json= cJSON_CreateObject();
	cJSON_AddStringToObject(json, "mode", mode);
	return json;
}


void sendmsg(cJSON *json, struct user *u){
	char *tmp, *buf;
	if(u->sbat==sbmax){
		if(showwarning) printf("send-buffer full.\n");
		return;
	}
	tmp= cJSON_PrintUnformatted(json); // jammer dat dit nodig is
	buf= malloc(lwsprepadding + strlen(tmp) + lwspostpadding);
	memcpy(buf + lwsprepadding, tmp, strlen(tmp));
	free(tmp);
	u->sb[u->sbat++]= buf;
	libwebsocket_callback_on_writable(ctx, u->wsi);
}

void startgame(struct game *gm){
	//unsigned char buf[LWS_SEND_BUFFER_PRE_PADDING + 1024 + LWS_SEND_BUFFER_POST_PADDING];	
}

void remgame(struct game *gm){
	if(headgame == gm)
		headgame = gm->nxt;
	else {
		struct game *a;
		for(a = headgame; a->nxt != gm; a = a->nxt);
		a->nxt = gm->nxt;
	}

	/* freeing up player nodes. */
	struct usern *next, *current;
	
	for(current = gm->usrn; current; current = next) {
		next = current->nxt;
		free(current);
	}		

	/* freeing up segments */
	if(gm->seg){
		int i, num_tiles = gm->htiles * gm->vtiles;

		for(i=0; i < num_tiles; i++) {
			struct seg *a, *b;

			for(a = gm->seg[i]; a; a = b) {
				b = a->nxt;
				free(a);
			}
		}

		free(gm->seg);
	}

	free(gm);
}

struct game* findgame(int nmin, int nmax) {
	struct game *gm;

	for(gm = headgame; gm; gm = gm->nxt)
		if(gm->nmin <= nmax && gm->nmax >= nmin) {
			gm->nmin = (gm->nmin > nmin) ? gm->nmin : nmin;
			gm->nmax = (gm->nmax < nmax) ? gm->nmax : nmax;
			return gm;
		}

	return NULL;
}

void leavegame(struct user *u) {
	struct game *gm;
	struct usern *current, *tmp;
	
	if(!u || !(gm = u->gm))
		return;

	for(current = gm->usrn; current->nxt && current->nxt->usr != u; current = current->nxt);

	// this should never be the case
	if(!current->nxt)
		return;

	tmp = current->nxt;
	current->nxt = tmp->nxt;
	free(tmp);

	if(!--gm->n)
		remgame(gm);

	u->gm = NULL;

	/* TODO: send message to group: this player left */
}

void adduser(struct game *gm, struct user *u) {
	struct usern *new;

	/* TODO: send message to group: we have new player */
	
	new = smalloc(sizeof(struct usern));

	new->usr = u;
	new->nxt = gm->usrn;
	u->gm = gm;

	if(++gm->n >= gm->nmin)
		startgame(gm);
}

struct game* creategame(int nmin, int nmax) {
	struct game *gm = smalloc(sizeof(struct game));

	gm->nmin = nmin; gm->nmax = nmax;
	gm->t = 0.0;
	gm->n= 0;
	gm->usrn= 0;
	gm->w= 800; gm->h= 800; // FIXME: these numbers should be defined as constant
	gm->tilew = 100; gm->tileh = 100; //ditto
	gm->htiles= gm->w / gm->tilew; gm->vtiles= gm->h / gm->tileh; // FIXME: round up, not down!
	gm->state= gs_lobby;
	gm->nxt = headgame;
	headgame = gm;
	gm->seg = smalloc(gm->htiles * gm->vtiles * sizeof(struct seg*));

	return gm;
}

// returns 1 if collision, 0 if no collision
int segcollision(struct seg *seg1, struct seg *seg2) {
	int denom = (seg1->x1 - seg1->x2) * (seg2->y1 - seg2->y2) -
	 (seg1->y1 - seg1->y2) * (seg2->x1 - seg2->x2);

	int numer_a = (seg2->x2 - seg2->x1) * (seg1->y1 - seg2->y1) -
	 (seg2->y2 - seg2->y1) * (seg1->x1 - seg2->x1);

	int numer_b = (seg1->x2 - seg1->x1) * (seg1->y1 - seg2->y1) -
	 (seg1->y2 - seg1->y1) * (seg1->x1 - seg2->x1);

	/* lines coincide */
	if(abs(numer_a) < EPS && abs(numer_b) < EPS && abs(denom) < EPS)
		return 1;

	/* lines parallel */
	if(abs(denom) < EPS)
		return 0;

	int a = numer_a/ denom;
	int b = numer_b/ denom;

	if(a < 0 || a > 1 || b < 0 || b > 1)
		return 0;

	return 1;
}

// returns 1 in case the segment intersects the box
int lineboxcollision(struct seg *seg, int left, int bottom, int right, int top) {
	/* if the segment intersects box, either both points are in box, 
	 * or there is intersection with the edges. note: this is naive way.
	 * there is probably a more efficient way to do it */

	if(seg->x1 >= left && seg->x1 < right && seg->y1 >= bottom && seg->y1 < top)
		return 1;

	if(seg->x2 >= left && seg->x2 < right && seg->y2 >= bottom && seg->y2 < top)
		return 1;

	struct seg edge;

	/* check intersect left border */
	edge.x1 = edge.x2 = left;
	edge.y1 = bottom;
	edge.y2 = top;
	if(segcollision(seg, &edge))
		return 1;

	/* check intersect right border */
	edge.x1 = edge.x2 = right;
	if(segcollision(seg, &edge))
		return 1;

	/* check intersect top border */
	edge.x1 = left;
	edge.y1 = edge.y2 = top;
	if(segcollision(seg, &edge))
		return 1;

	/* check intersect top border */
	edge.y1 = edge.y2 = bottom;
	if(segcollision(seg, &edge))
		return 1;

	return 0;
}

// returns 1 in case of collision, 0 other wise
int addsegment(struct game *gm, struct seg *seg) {
	int left_tile, right_tile, bottom_tile, top_tile, swap;
	struct seg *current, *copy;

	left_tile = seg->x1/ gm->tilew;
	right_tile = seg->x2/ gm->tilew;
	if(left_tile > right_tile) {
		swap = left_tile; left_tile = right_tile; right_tile = swap;
	}

	bottom_tile = seg->y1/ gm->tileh;
	top_tile = seg->y2/ gm->tileh;
	if(bottom_tile > top_tile) {
		swap = bottom_tile; bottom_tile = top_tile; top_tile = swap;
	}

	for(int i = left_tile; i <= right_tile; i++) {
		for(int j = bottom_tile; j <= top_tile; j++) {
			if(!lineboxcollision(seg, i * gm->tilew, j * gm->tileh,
			 (i + 1) * gm->tilew, (j + 1) * gm->tileh))
				continue;

			for(current = gm->seg[gm->htiles * j + i]; current; current = current->nxt)
				if(segcollision(seg, current))
					return 1;

			copy = smalloc(sizeof(struct seg));
			memcpy(copy, seg, sizeof(struct seg));
			copy->nxt = gm->seg[gm->htiles * j + i];
		}
	}

	// we dont need the original any more: free it
	free(seg);

	return 0;
}

void mainloop(){
	
}